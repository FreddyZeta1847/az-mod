<p align="center">
  <h1 align="center">az-mod</h1>
  <p align="center"><b>Your project's Azure resources, live beside the chat.</b></p>
  <p align="center">A Claude Code mod that finds the Azure resources of the current project, shows them in a side pane and keeps them up to date, using read-only Azure CLI calls.</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Azure-0078D4?style=for-the-badge&logo=microsoftazure&logoColor=white" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" />
</p>

## What it is

az-mod adds a side pane called **Azure** to Claude Code. The pane lists the Azure resources that belong to the project you are working in. It shows their status at a glance and refreshes itself while you work, so you do not have to ask Claude or open the portal to see what is running.

> The pane's labels and messages are in Italian.

## Features

- **Automatic first Scan.** The first time you open a project, az-mod looks through your subscription. It adopts the resource group `rg-<folder name>` when it exists. It also proposes related resources, with the reason for each: same repository, an image named after the project, names found in the project's files, resources used by resources you already have.
- **Status summary.** A donut chart and a legend count the resources by state, plus how long ago the data was refreshed.
- **One card per resource.** Each card shows facts that depend on the resource type (for example URL, image, replicas and revision for a container app; SKU, redundancy and access tier for a storage account).
- **Month's cost.** The cost of the month so far, for each resource and for the project, beside the whole of last month, with a bar by resource type. Read twice a day and with the **Aggiorna costi** button. Resources taken out of the project are not counted.
- **Da guardare.** At most four warnings, each with its cause and what to do: a failed revision, a stopped app, a cost above 1.5 times last month, a Key Vault without soft delete or purge protection, a container registry with the admin user enabled.
- **Recent activity.** The last week of changes in the project (created or changed, deleted, restarted, stopped…), read every 15 minutes and when you open a card. A change Claude made in this session is marked **da Claude**.
- **Live updates.**
  - Every 2 minutes while the pane is placed.
  - Every 10 minutes after 30 minutes without input.
  - With backoff after errors: 2, 4, 8, 16, then 30 minutes (longer if Azure asks).
  - Right after a write `az` command that Claude runs. The hook understands the command, and a write refreshes the card it touched. A resource Claude wrote that is not in the project yet is offered to you.
- **You decide what belongs to the project.**
  - Add a group or a resource with **+ Aggiungi** (search).
  - Remove a group with **×**.
  - Hide a resource with **× Togli dal progetto**, and restore it from **Nascoste**.
  - Show the resources Azure created by itself with the **create da Azure** toggle.
  - Run **Scan** again whenever you want new suggestions: after the first time, the Scan only runs when you press the button.
- **`/az` command.** Reopens the pane if you closed it.
- **Several sessions, one project.** Sessions on the same project share one rules file. Before every change the file is read again, so one session never wipes another's changes.

## Requirements

- Claude Code 2.1.275 or later.
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed, with `az login` done.
- At least read access (Reader) to the subscription.

## Installation

The repository is its own plugin marketplace, so the mod installs with one line.

**1. From the prompt of a Claude Code terminal session:**

```
/plugin install az-mod --marketplace FreddyZeta1847/az-mod
```

Answer `y` to add the marketplace, then choose a scope: every project (user) or only the current one.

**2. From a shell:**

```
claude plugin install az-mod --marketplace FreddyZeta1847/az-mod
```

**3. In the Claude desktop app** (where `/plugin` does not run): click **+** next to the prompt box, then **Plugins**, then **Add marketplace** with `FreddyZeta1847/az-mod`, then **Add plugin**.

**4. Only for one project:** once the marketplace has been added, run this from that project's folder:

```
claude plugin install az-mod@az-mod --scope local
```

The mod starts with the next session you open in that folder. In the desktop app, open the session in the project folder itself, not in a worktree.

**5. Development from a clone:**

```
claude --plugin-dir <path to the clone>
```

Run the tests and the checks from the clone's folder:

```
claude plugin test .
claude plugin validate .
```

## Usage

1. Open Claude Code in a project folder and send your first message: the session starts and the **Azure** pane opens by itself.
2. On a first open, az-mod runs a Scan. If the group `rg-<folder name>` exists, the pane shows "Uso rg-... (N risorse)" with an **Annulla** button to undo the choice. Suggested resources appear under "Forse del progetto" with **Aggiungi** and **No** buttons.
3. Click a resource's name to open its card. Failed resources open by themselves. Each card links to the Azure portal and can copy the resource name or refresh just that resource.
4. Press **Update** to refresh now, **Scan** to look for more resources, **+ Aggiungi** to search by name.
5. If you close the pane, type `/az` to bring it back.

If the login has expired, or Azure CLI is missing, the pane says so in a banner. Run `az login` in your terminal and press **Update**.

## Where data is stored

Everything lives in the plugin's data folder (`<CLAUDE_PLUGIN_DATA>/projects/`). Nothing is written in your repository.

| File | Content |
| --- | --- |
| `<key>.rules.json` | Your choices for the project: groups, included and hidden resources, dismissed suggestions. Kept across sessions. |
| `<key>.rules.bak.json` | The previous version of the rules, written before every save. |
| `<key>.cache.json` | The last snapshot of Azure. Safe to discard. |
| `<key>.broken-<ms>.json` | A damaged rules file, set aside by **Riparti da zero**. |

`<key>` comes from the project's folder name. If another repository already uses the same name, the project gets its own rules file, with a short hash added to the key.

If the rules file and its backup are both damaged, the pane shows **Riparti da zero (salvo il file rotto)**: it keeps the damaged file aside and starts again from empty rules. If the rules come from a newer version of the mod, the pane shows them but does not change them.

## Security

az-mod is built to never read or keep a secret.

- **Read-only Azure calls.** The mod only runs `az account show`, `az resource list`, `az resource show`, `az monitor activity-log list`, and Azure Resource Graph and Cost Management queries (`az rest`, a POST that only reads). It never runs commands that print secrets, such as keys, connection strings, `list-keys` or Key Vault secret values.
- **Activities keep four fields.** From the activity log only the time, the operation, the outcome and the resource are kept: never the content of a request, the caller or their claims.
- **Named fields only.** The Resource Graph query asks for a fixed list of fields and never for `properties` as a whole. Container app environment variable values therefore never reach a card.
- **Facts come from an allow-list.** Each card shows only the facts defined for its resource type.
- **Secrets filter.** Every value read from Azure goes through a filter before it is kept. It drops anything that looks like an account key, a shared access signature, a `sig=` parameter, a JWT, a GitHub token, a password, or a long mixed-case or hex run. Kept strings are cut at 256 characters.
- **The hook never keeps command text.** When Claude runs a shell command, the hook lets it run untouched, never denies or rewrites it and never reads its output. It only keeps clean tokens: the command group, the verb, a resource name, a resource group and resource ids. A command with a chain, pipe, newline, backtick or `$` is treated as unclear and keeps nothing; it only triggers an Update.
- **Short errors.** A failed `az` call keeps only the first line of stderr, at most 200 characters.

## Roadmap

Later:

- Metric charts in an open card.
- Certificate expiry dates.
- The latest images of a container registry and the last Web App deploy.

## Project structure

| Folder | Content |
| --- | --- |
| `hooks/collect/` | The collection side: the `az` hook, the Scan, Azure Resource Graph reads, the refresh rhythm, the rules and cache files, the secrets filter. |
| `hooks/pane/` | The dashboard and its buttons. |
| `hooks/fixtures/` | Invented Azure answers used by the tests. |
| `types/` | Type definitions of the mod's data. |
| `.claude-plugin/` | The plugin manifest and the marketplace entry. |

`hooks/index.ts` is the entry point. `hooks/contract.ts` holds the shared state, constants and button keys. The two sides never call each other.

## License

[MIT](LICENSE)
