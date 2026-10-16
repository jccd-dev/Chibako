"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import {
  deleteMoneyCharacter,
  displayMoney,
  moneyCaretInDisplay,
  moneyCharactersBefore,
  sanitizeMoneyInput,
} from "./money-input";

type MoneyInputProps = Omit<React.ComponentProps<"input">, "onChange" | "type" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
  signed?: boolean;
};

// Comma-aware single-character deletion: native Delete at a caret sitting
// before a grouping comma only removes the comma itself, and re-grouping
// restores it with the caret unchanged, so the key stalls. Both Backspace and
// Delete are handled here for keyboard input and in beforeinput for native
// deleteContentBackward/Forward (mobile soft keys).
export function MoneyInput({ value, onValueChange, signed = false, ref: externalRef, onKeyDown, ...props }: MoneyInputProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const pendingCaret = React.useRef<number | null>(null);
  const setRefs = React.useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof externalRef === "function") externalRef(node);
    else if (externalRef) externalRef.current = node;
  }, [externalRef]);
  function placeCaret(node: HTMLInputElement, nextValue: string, raw: string, caretIndex: number | null) {
    const display = displayMoney(nextValue);
    const position = moneyCaretInDisplay(display, moneyCharactersBefore(raw, caretIndex));
    if (node.value !== display) node.value = display;
    node.setSelectionRange(position, position);
  }
  function handleDeletion(node: HTMLInputElement, caret: number, backward: boolean): boolean {
    // Applies a comma-aware deletion and returns true when the edit was
    // applied here and native/default handling should be cancelled.
    const result = deleteMoneyCharacter(node.value, caret, backward);
    // Only intercept when the deletion spans a grouping comma; a plain
    // significant character is left to native editing and the change path.
    if (!result || result.to - result.from < 2) return false;
    const next = sanitizeMoneyInput(result.value, signed);
    if (next === null) return false;
    pendingCaret.current = moneyCharactersBefore(result.value, result.caret);
    onValueChange(next);
    return true;
  }
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const node = event.currentTarget;
    const caret = node.selectionStart;
    if (!event.defaultPrevented && (event.key === "Delete" || event.key === "Backspace") && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const backward = event.key === "Backspace";
      if (caret !== null && caret === node.selectionEnd) {
        if (caret !== (backward ? 0 : node.value.length) && handleDeletion(node, caret, backward)) {
          event.preventDefault();
          return;
        }
      }
    }
    onKeyDown?.(event);
  }
  React.useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    // React only dispatches onBeforeInput when the native event has text
    // data, which deletions never do; listen to beforeinput directly so
    // native deleteContentBackward/Forward (mobile soft keys) also handle
    // grouping commas explicitly.
    const listener = (event: InputEvent) => {
      const backward = event.inputType === "deleteContentBackward";
      if (!backward && event.inputType !== "deleteContentForward") return;
      const caret = node.selectionStart;
      if (caret === null || caret !== node.selectionEnd) return;
      if (caret !== (backward ? 0 : node.value.length) && handleDeletion(node, caret, backward)) {
        event.preventDefault();
      }
    };
    node.addEventListener("beforeinput", listener);
    return () => node.removeEventListener("beforeinput", listener);
  });
  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const node = event.target;
    const raw = node.value;
    const next = sanitizeMoneyInput(raw, signed);
    if (next === null) {
      // Rejected edit: keep the previous value exactly; nothing becomes a
      // different valid amount.
      placeCaret(node, value, raw, node.selectionStart);
      pendingCaret.current = null;
      return;
    }
    if (next === value) {
      // Accepted but unchanged state: React will not re-render, restore the
      // grouped display synchronously (e.g. a removed grouping comma).
      placeCaret(node, next, raw, node.selectionStart);
      pendingCaret.current = null;
      onValueChange(next);
      return;
    }
    pendingCaret.current = moneyCharactersBefore(raw, node.selectionStart);
    onValueChange(next);
  }
  React.useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (pending === null) return;
    pendingCaret.current = null;
    const node = inputRef.current;
    if (!node || node.disabled || node !== document.activeElement) return;
    const display = displayMoney(value);
    const position = moneyCaretInDisplay(display, pending);
    node.setSelectionRange(position, position);
  });
  return (
    <Input
      ref={setRefs}
      type="text"
      inputMode="decimal"
      value={displayMoney(value)}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
}
