# `npm publish` Patcher

[**⚖️** MIT](./LICENSE.md)

🔗
[GitHub](https://github.com/hugoalh/npm-publish-patcher)

Patch things for [`npm publish`](https://docs.npmjs.com/cli/commands/npm-publish):

- Automatically handle distribution tag for non latest release version.
- Automatically publish with provenance when device is compatible and support, and fallback to publish without provenance if failed.
- Bypass original foolish publish check.

> [!CAUTION]
> - This is not planned to have any public release version.

## ▶️ Begin - Deno

- **[Deno](https://deno.land/)** >= v2.5.4
- **[NPM](https://www.npmjs.com/package/npm)** \^ v11.6.0

### 🛡️ Runtime Permissions

- Environment Variable (`env`)
- File System - Read (`read`)
- Network (`net`)
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
| `dry-run` | `boolean` | Dry run (i.e.: for publish check). |
| `no-check-bypass` | `boolean` | Not to bypass original foolish publish check. |
| `no-provenance-fallback` | `boolean` | Not to fallback to publish without provenance if publish with provenance is failed. |
| `provenance` | `enum = "auto"` | Provenance; `"auto"` to automatically determine provenance is available or not. |
| `registry` | `string` | Registry; Domain and path only. (e.g.: `npm.pkg.github.com`, `forgejo.example.com/api/packages/{Owner}/npm`) |
| `tag-non-latest` | `string = "recent"` | Tag for publish non latest release version. |
| `token` | `string` | Token. |
| `workspace` | `string` | Workspace. |
