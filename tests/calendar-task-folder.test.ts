import assert from "node:assert/strict";
import { test } from "node:test";
import { taskFolder } from "../src/features/calendar/task-folder";

test("task folder rule keeps Tasks folders and nests others under Tasks", () => {
  assert.equal(taskFolder(""), "Tasks");
  assert.equal(taskFolder("/"), "Tasks");
  assert.equal(taskFolder("Tasks"), "Tasks");
  assert.equal(taskFolder("Projects/Acme"), "Projects/Acme/Tasks");
  assert.equal(taskFolder("Projects/Acme/"), "Projects/Acme/Tasks");
  assert.equal(taskFolder("Projects/Acme/Tasks"), "Projects/Acme/Tasks");
  assert.equal(taskFolder("MyTasks"), "MyTasks/Tasks");
});

test("calendar folder filter includes subfolders and lists ancestors", async () => {
  const { inFolder, folderChoices } = await import("../src/features/calendar/task-folder");
  assert.equal(inFolder("Projects/Acme/Tasks", "Projects/Acme"), true);
  assert.equal(inFolder("Projects/Acme", "Projects/Acme"), true);
  assert.equal(inFolder("Projects/Acmeville", "Projects/Acme"), false);
  assert.equal(inFolder("", ""), true);
  assert.equal(inFolder("", "Projects"), false);
  assert.deepEqual(folderChoices(["Projects/Acme/Tasks", "", "Work"]), ["Projects", "Projects/Acme", "Projects/Acme/Tasks", "Work"]);
});
