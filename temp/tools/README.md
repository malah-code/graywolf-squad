# temp/tools — Spec Kit Progress Toolkit

## What's here

- **`speckit-progress.md`** — The authoritative Spec Kit phase progress tracker (17 phases, 9 steps each). It contains:
  - §2 Phase Progress Board (checkboxes for every step of every phase)
  - §3 "What is the next step?" Reply Protocol the AI must follow
  - §4 Update Protocol the AI must execute immediately after completing any step
  - §5 Progress Log + §6 Blockers & Decisions (append-only)

## How to use (you don't need to edit anything by hand)

### 1. Ask for the next step
Just type in chat:

```text
what is the next step?
```

The AI (via `AGENTS.md` §4) is required to read `speckit-progress.md`, find the first unchecked checkbox, and reply in the compact format:

```text
📍 Current position: Phase P0 (Bootstrap) — Stage A, Step 2/7
▶️  Next step: /speckit-specify ...
⏸  Blocked by: nothing
```

Other prompts that trigger the same protocol: `continue`, `where are we?`, `what now?`

### 2. Run the step
Copy the exact command the AI gives you (e.g. `/speckit-specify Phase 0 ...`) and run it.

### 3. Status updates are automatic
After any step completes (specify / clarify / plan / tasks / analyze / your approval / implement / converge), the AI must immediately:

- Tick the checkbox in the tracker's Phase Progress Board,
- Update the phase's Final Phase Status,
- Append one line to the Progress Log.

This is enforced through **`AGENTS.md` §4 "SPEC KIT PROGRESS TRACKING"**, which is auto-injected into every agent session — no manual updates required by you.

### 4. The one thing only you can do: the Human Gate (Step 7)
When the AI tells you a phase is awaiting approval, review:

- `specs/<NNN>-<slug>/spec.md`
- `specs/<NNN>-<slug>/plan.md`
- `specs/<NNN>-<slug>/tasks.md`

Then reply either `approved` (AI proceeds to `/speckit-implement`) or list change requests.
