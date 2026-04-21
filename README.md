# `npm publish` Patcher

[**⚖️** MIT](./LICENSE.md)

🔗
[GitHub](https://github.com/hugoalh/npm-publish-patcher)

Patch for [`npm publish`](https://docs.npmjs.com/cli/commands/npm-publish):

- Automatic determine provenance is available or not.
- Ignore specific errors.

> [!CAUTION]
> - This is planned to not have any public release version.

## ▶️ Begin - Deno

- **[Deno](https://deno.land/)** >= v2.5.4
- **[NPM](https://www.npmjs.com/package/npm)** \^ v11.6.0

### 🛡️ Runtime Permissions

- Environment Variable (`env`)
- File System - Read (`read`)
  - *Resources*
- File System - Write (`write`)
  - *Resources*
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
| `cleanup` | `boolean` | Cleanup at the end; Include registry and token. |
| `cwd` | `string` | Workspace. |
| `dry-run` | `boolean` | Dry run. |
| `ignore-ppv` | `boolean` | Ignore the error of "previously published versions". |
| `provenance` | `enum = "auto"` | Provenance; `"auto"` to automatic determine provenance is available or not. |
| `registry` | `string` | Registry; Domain and path only. |
| `token` | `string` | Token. |
