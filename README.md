# `npm publish` Patcher

[**⚖️** MIT](./LICENSE.md)

🔗
[GitHub](https://github.com/hugoalh/npm-publish-patcher)

Patch for [`npm publish`](https://docs.npmjs.com/cli/commands/npm-publish):

- Automatically determine provenance is available or not.
- Automatically handle tag.
- Automatically provenance fallback.
- Bypass specific publish check.

> [!CAUTION]
> - This is planned to not have any public release version.

## ▶️ Begin - Deno

- **[Deno](https://deno.land/)** >= v2.5.4
- **[NPM](https://www.npmjs.com/package/npm)** \^ v11.6.0

### 🛡️ Runtime Permissions

- Environment Variable (`env`)
- File System - Read (`read`)
- Network (`net`)
- Subprocess (`run`)
  - `npm`

### #️⃣ Sources

- GitHub Raw
  ```
  https://raw.githubusercontent.com/hugoalh/npm-publish-patcher/{Tag}/deno/mod.ts
  ```

> [!NOTE]
> - It is recommended to include tag for immutability.
> - These are not part of the public APIs hence should not be used:
>   - Benchmark/Test file (e.g.: `example.bench.ts`, `example.test.ts`).
>   - Entrypoint name or path include any underscore prefix (e.g.: `_example.ts`, `foo/_example.ts`).
>   - Identifier/Namespace/Symbol include any underscore prefix (e.g.: `_example`, `Foo._example`).

### ⤵️ Entrypoints

| **Name** | **Path** | **Description** |
|:--|:--|:--|
| N/A | `./deno/cli.ts` | Default (CLI). |

## 🧩 CLIs

| **Argument** | **Type** | **Description** |
|:--|:--|:--|
| `dry-run` | `boolean` | Dry run. |
| `no-check-bypass` | `boolean` | Not to bypass specific publish check. |
| `no-provenance-fallback` | `boolean` | Not to republish without provenance after publish with provenance is failed. |
| `provenance` | `enum = "auto"` | Provenance; `"auto"` to automatically determine provenance is available or not. |
| `registry` | `string` | Registry; Domain and path only. |
| `tag-non-latest` | `string = "recent"` | Tag for publish non latest version. |
| `token` | `string` | Token. |
| `workspace` | `string` | Workspace. |
