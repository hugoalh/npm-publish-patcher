# `npm publish` Patcher

[**⚖️** MIT](./LICENSE.md)

🔗
[GitHub](https://github.com/hugoalh/npm-publish-patcher)

Patch things for [`npm publish`](https://docs.npmjs.com/cli/commands/npm-publish):

- Automatically handle distribution tag for non latest or pre-release version.
- Ignore foolish errors.

> [!CAUTION]
> - This is not planned to have any public release version.

## ▶️ Begin - Deno

- **[Deno](https://deno.land/)** >= v2.9.0
- **[NPM](https://www.npmjs.com/package/npm)** \^ v11.15.0

### 🛡️ Runtime Permissions

- Environment Variable (`env`)
- File System - Read (`read`)
- Subprocess (`run`)
  - `npm`

### #️⃣ Sources & Entrypoints

- GitHub Raw
  ```
  https://raw.githubusercontent.com/hugoalh/npm-publish-patcher/{Tag}/deno/mod.ts
  ```

| **Name** | **Path** | **Description** |
|:--|:--|:--|
| N/A | `./deno/cli.ts` | Default (CLI). |

> [!NOTE]
> - It is recommended to include tag for immutability.
> - These are not part of the public APIs hence should not be used:
>   - Benchmark/Test file (e.g.: `example.bench.ts`, `example.test.ts`).
>   - Entrypoint name or path include any underscore prefix (e.g.: `_example.ts`, `foo/_example.ts`).
>   - Identifier/Namespace/Symbol include any underscore prefix (e.g.: `_example`, `Foo._example`).

## 🧩 CLIs

| **Argument** | **Type** | **Description** |
|:--|:--|:--|
| `allow-foolish-errors` | `switch` | Whether to allow foolish errors. |
| `dry-run` | `switch` | Whether to dry run (i.e.: for publish check), equivalent to `npm --dry-run`. |
| `provenance` | `switch` | Whether to publish with provenance, equivalent to `npm --provenance`. |
| `registry` | `string` | Registry with domain and path only (e.g.: `npm.pkg.github.com`, `forgejo.example.com/api/packages/{Owner}/npm`). |
| `stage` | `switch` | Whether to stage publish, equivalent to `npm stage publish`. |
| `tag-current` | `string` | Tag for current publish, equivalent to `npm --tag {Tag}`. |
| `tag-non-latest` | `string = "recent"` | Tag for publish non latest or pre-release version; `tag-current` takes priority over this. |
| `token` | `string` | Token; Also accept environment variable name by redirect mode (read by `npm`) with pattern `#{Env}` (e.g.: `#NPM_TOKEN`), or by set mode (write to NPM config) with pattern `^{Env}` (e.g.: `^NPM_TOKEN`). |
| `workspace` | `string` | Workspace. |
