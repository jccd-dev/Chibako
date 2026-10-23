import assert from "node:assert/strict";
import { test } from "node:test";
import { GALAXY_CAPACITY, galaxyLayout } from "../src/lib/graph-layout";
import { radialLayout } from "../src/lib/graph-radial-layout";

function vault(count: number, orphans = 0) {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, kind: i === 0 ? "index" : "wiki" }));
  // Hub-and-chain tree: every node links to an earlier one.
  const links = nodes.slice(1, count - orphans).map((n, i) => ({ source: n.id, target: `n${Math.floor(i / 3)}` }));
  return { nodes, links };
}

test("layout is deterministic and finite", () => {
  const { nodes, links } = vault(120, 20);
  const a = galaxyLayout(nodes, links);
  const b = galaxyLayout(nodes, links);
  assert.deepEqual([...a.placements], [...b.placements]);
  assert.equal(a.placements.size, nodes.length);
  for (const p of a.placements.values()) {
    assert(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert(p.radius01 >= 0 && p.radius01 <= 1);
  }
});

test("an index note takes the galaxy core", () => {
  const nodes = [
    { id: "a", kind: "wiki" },
    { id: "b", kind: "wiki" },
    { id: "c", kind: "wiki" },
    { id: "home", kind: "index" },
  ];
  const links = [
    { source: "a", target: "b" },
    { source: "a", target: "c" },
    { source: "home", target: "c" },
  ];
  const layout = galaxyLayout(nodes, links);
  assert.equal(layout.galaxies[0].core, "home");
  assert.deepEqual(layout.placements.get("home"), { x: 0, y: 0, galaxy: 0, radius01: 0 });
});

test("a full galaxy overflows into a second, non-overlapping galaxy", () => {
  const count = GALAXY_CAPACITY + 60;
  const { nodes, links } = vault(count, 30);
  const layout = galaxyLayout(nodes, links);
  assert.equal(layout.galaxies.length, 2);
  assert(layout.galaxies.every((g) => g.count <= GALAXY_CAPACITY));
  const [first, second] = layout.galaxies;
  assert(Math.hypot(first.x - second.x, first.y - second.y) >= first.radius + second.radius);
  for (const p of layout.placements.values()) {
    const g = layout.galaxies[p.galaxy];
    assert(Math.hypot(p.x - g.x, p.y - g.y) <= g.radius);
  }
});

test("small vaults form one galaxy centered at the origin", () => {
  const layout = galaxyLayout(vault(40).nodes, vault(40).links);
  assert.equal(layout.galaxies.length, 1);
  assert.deepEqual([layout.galaxies[0].x, layout.galaxies[0].y], [0, 0]);
});

test("components that fit stay in one galaxy", () => {
  // Two 4-node chains and filler that forces three galaxies at capacity 6.
  const chain = (p: string) => [0, 1, 2, 3].map((i) => ({ id: `${p}${i}`, kind: "wiki" }));
  const nodes = [...chain("a"), ...chain("b"), ...chain("c")];
  const links = ["a", "b", "c"].flatMap((p) => [0, 1, 2].map((i) => ({ source: `${p}${i}`, target: `${p}${i + 1}` })));
  const layout = galaxyLayout(nodes, links, { capacity: 6 });
  for (const p of ["a", "b", "c"]) {
    const galaxies = new Set([0, 1, 2, 3].map((i) => layout.placements.get(`${p}${i}`)?.galaxy));
    assert.equal(galaxies.size, 1);
  }
});

test("orphans sit toward the rim", () => {
  const { nodes, links } = vault(100, 30);
  const layout = galaxyLayout(nodes, links);
  const mean = (ids: string[]) => ids.reduce((s, id) => s + (layout.placements.get(id)?.radius01 ?? 0), 0) / ids.length;
  const orphanIds = nodes.slice(70).map((n) => n.id);
  const linkedIds = nodes.slice(0, 70).map((n) => n.id);
  assert(layout.galaxies.length === 1);
  assert(mean(orphanIds) > mean(linkedIds) + 0.2);
});

// A home index with six hubs, each owning a few leaves, plus a few orphans.
function hubVault(orphans = 4) {
  const nodes = [{ id: "home", kind: "index" }];
  const links: Array<{ source: string; target: string }> = [];
  for (let h = 0; h < 6; h++) {
    nodes.push({ id: `hub${h}`, kind: "wiki" });
    links.push({ source: "home", target: `hub${h}` });
    for (let c = 0; c < 4 + h; c++) {
      nodes.push({ id: `hub${h}-leaf${c}`, kind: "wiki" });
      links.push({ source: `hub${h}`, target: `hub${h}-leaf${c}` });
    }
  }
  for (let o = 0; o < orphans; o++) nodes.push({ id: `orphan${o}`, kind: "wiki" });
  return { nodes, links };
}

test("radial layout is deterministic and finite", () => {
  const { nodes, links } = vault(120, 20);
  const a = radialLayout(nodes, links);
  const b = radialLayout(nodes, links);
  assert.deepEqual([...a.placements], [...b.placements]);
  assert.equal(a.placements.size, nodes.length);
  for (const p of a.placements.values()) {
    assert(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert(p.radius01 >= 0 && p.radius01 <= 1);
  }
});

test("radial puts the top note at the circle center", () => {
  const { nodes, links } = hubVault();
  const layout = radialLayout(nodes, links);
  assert.equal(layout.galaxies[0].core, "home");
  assert.deepEqual(layout.placements.get("home"), { x: 0, y: 0, galaxy: 0, radius01: 0, cluster: 0 });
});

test("radial fans each hub's notes around that hub, in disjoint bursts", () => {
  const { nodes, links } = hubVault();
  const { placements } = radialLayout(nodes, links);
  const hubs = Array.from({ length: 6 }, (_, h) => `hub${h}`);
  const at = (id: string) => placements.get(id)!;
  const dist = (a: string, b: string) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);

  const burstRadius = new Map<string, number>();
  for (const hub of hubs) {
    const leaves = nodes.filter((n) => n.id.startsWith(`${hub}-leaf`)).map((n) => n.id);
    const reach = Math.max(...leaves.map((l) => dist(l, hub)));
    burstRadius.set(hub, reach);
    for (const leaf of leaves) {
      assert.equal(at(leaf).cluster, at(hub).cluster);
      for (const other of hubs.filter((h) => h !== hub)) assert(dist(leaf, hub) < dist(leaf, other), `${leaf} nearer ${other}`);
    }
  }
  for (const a of hubs) {
    for (const b of hubs.filter((h) => h > a)) assert(dist(a, b) > burstRadius.get(a)! + burstRadius.get(b)!, `${a} and ${b} overlap`);
  }
  // Bigger hubs sit on inner rings.
  const fromCenter = (id: string) => Math.hypot(at(id).x, at(id).y);
  assert(fromCenter("hub5") <= fromCenter("hub0") + 1e-6);
});

test("radial orphans sit on the outer ring", () => {
  const { nodes, links } = hubVault(6);
  const { placements, galaxies } = radialLayout(nodes, links);
  const dist = (id: string) => Math.hypot(placements.get(id)!.x, placements.get(id)!.y);
  const linked = nodes.filter((n) => !n.id.startsWith("orphan")).map((n) => dist(n.id));
  const orphans = nodes.filter((n) => n.id.startsWith("orphan"));
  for (const o of orphans) {
    assert.equal(placements.get(o.id)!.cluster, -1);
    assert(dist(o.id) > Math.max(...linked));
    assert(dist(o.id) <= galaxies[0].radius);
  }
});

test("a full radial circle overflows into a second, non-overlapping circle", () => {
  const { nodes, links } = vault(GALAXY_CAPACITY + 60, 30);
  const layout = radialLayout(nodes, links);
  assert.equal(layout.galaxies.length, 2);
  assert(layout.galaxies.every((g) => g.count <= GALAXY_CAPACITY));
  const [first, second] = layout.galaxies;
  assert(Math.hypot(first.x - second.x, first.y - second.y) >= first.radius + second.radius);
  for (const p of layout.placements.values()) {
    const g = layout.galaxies[p.galaxy];
    assert(Math.hypot(p.x - g.x, p.y - g.y) <= g.radius);
  }
});
