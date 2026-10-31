# Catalog — one map of all projects

Goal: when working in one project, the agent knows what exists in the others and can spot reuse, integration, or merge opportunities. Projects stay separate repos.

## Files

| Path | Content |
|---|---|
| `projects/<name>.md` | One card per project: summary, stack, structure, reusable pieces |
| `links.md` | Cross-project opportunities (reuse, integrate, merge-candidate) |
| `HANDOFF.md` | Pointer. Spostato in SecondBrain/system/HANDOFF.md |
| `TODO.md` | Pointer. Spostato in SecondBrain/system/TODO.md |
| `AUDIT_PLAN.md`, `audit/` | Pointers. Spostato in SecondBrain/system/AUDIT_PLAN.md e `system/audit/` |

Each card starts with front matter: `repo`, `visibility` (`public` or `private`), `status`, `updated`.

## Visibility

- Private projects receive the full catalog in `.cursor/catalog/`.
- Public projects receive only cards with `visibility: public`, and no `links.md`. Private project names and details never enter a public repo.

## How it is kept current

- Delivery: the hub Action `Sync rules, catalog, and deploy kit to projects` copies rules, hooks, the shared `deploy/` scripts, and the catalog (every owned repo, minus `.github/sync-exclude.txt`; visibility is read from GitHub). Product files under `deploy/` are not part of that copy.
- Content: the agent updates the card of the project it worked on, and adds to `links.md`, at the end of each task (rule `cross-project-awareness`).
- Planned: a scheduled builder that refreshes stack and structure from each repo.

## Limits

Cards are maps with file paths, not copies of the code. Open the real file in the project repo when details matter.
