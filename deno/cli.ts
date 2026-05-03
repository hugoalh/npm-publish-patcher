import { parseArgs } from "jsr:@std/cli@^1.0.25/parse-args";
import { compare as compareSemVer } from "jsr:@std/semver@^1.0.8/compare";
import { equals as areSemVersEqual } from "jsr:@std/semver@^1.0.8/equals";
import { format as stringifySemVer } from "jsr:@std/semver@^1.0.8/format";
import { parse as parseSemVer } from "jsr:@std/semver@^1.0.8/parse";
import type { SemVer } from "jsr:@std/semver@^1.0.8/types";
import {
	isAbsolute as isPathAbsolute,
	join as joinPath,
	normalize as normalizePath
} from "node:path";
//@ts-types="npm:@types/npm-registry-fetch@^8.0.9"
import npmRegistryFetch from "npm:npm-registry-fetch@^19.1.1";
import yoctocolors from "npm:yoctocolors@^2.1.2";
if (!import.meta.main) {
	throw new Error(`This entrypoint is for command line only!`);
}
function logError(message: string): never {
	console.error(`${yoctocolors.red("ERR")} \t${message}`);
	throw new Error(message);
}
function logInfo(message: string): void {
	console.info(`${yoctocolors.blue("INFO")}\t${message}`);
}
function logWarn(message: string): void {
	console.warn(`${yoctocolors.yellow("WARN")}\t${message}`);
}
function getEnvSafe(key: string): string | undefined {
	try {
		return Deno.env.get(key);
	} catch {
		return undefined;
	}
}
function isEnvironmentAllowProvenance(): boolean {
	return (
		(getEnvSafe("GITHUB_ACTIONS") === "true" && getEnvSafe("RUNNER_ENVIRONMENT") === "github-hosted") ||
		(getEnvSafe("GITLAB_CI") === "true")
	);
}
function resolveProvenanceStatus(input: string = "auto"): boolean {
	switch (input.toLowerCase()) {
		case "false":
			return false;
		case "true":
			return true;
		default:
			logWarn(`Invalid argument \`provenance = ${input}\`, ignored.`);
		// FALL THROUGH
		case "auto":
			return isEnvironmentAllowProvenance();
	}
}
interface NPPAgentParameters {
	checkBypass?: boolean;
	provenance?: string;
	provenanceFallback?: boolean;
	registry?: string;
	tagNonLatest?: string;
	workspace?: string;
}
type NPPAgentCommandOptions = Omit<Deno.CommandOptions, "args" | "cwd">;
class NPPAgent {
	#checkBypass: boolean;
	#cwd: string;
	#npmConfig?: Readonly<Record<string, unknown>>;
	#packageManifest?: Readonly<Record<string, unknown>>;
	#packageMeta?: Readonly<Record<string, unknown>>;
	#packageName?: string;
	#packageVersion?: SemVer;
	#provenance: boolean;
	#provenanceFallback: boolean;
	#registryInput?: string;
	#registryNPMConfig?: string;
	#tagNonLatest: string;
	#tokenCleanupKey: string | null = null;
	constructor(param: NPPAgentParameters = {}) {
		const {
			checkBypass = true,
			provenance,
			provenanceFallback = true,
			registry,
			tagNonLatest = "recent",
			workspace
		}: NPPAgentParameters = param;
		this.#checkBypass = checkBypass;
		if (typeof workspace === "undefined") {
			this.#cwd = Deno.cwd();
		} else if (isPathAbsolute(workspace)) {
			this.#cwd = workspace;
		} else {
			this.#cwd = normalizePath(joinPath(Deno.cwd(), workspace));
		}
		this.#provenance = resolveProvenanceStatus(provenance);
		this.#provenanceFallback = provenanceFallback;
		this.#registryInput = registry;
		this.#tagNonLatest = tagNonLatest;
	}
	constructCommand(command: readonly string[], options: NPPAgentCommandOptions = {}): Deno.Command {
		const {
			clearEnv,
			detached,
			env = {},
			...optionsRest
		}: NPPAgentCommandOptions = options;
		return new Deno.Command(command[0], {
			...optionsRest,
			args: command.slice(1),
			clearEnv: clearEnv ?? false,
			cwd: this.#cwd,
			detached: detached ?? false,
			env: {
				NPM_CONFIG_FUND: "false",
				NPM_CONFIG_GIT_TAG_VERSION: "false",
				NPM_CONFIG_PROGRESS: "false",
				NPM_CONFIG_UNICODE: "true",
				NPM_CONFIG_UPDATE_NOTIFIER: "false",
				...env
			}
		});
	}
	async getNPMConfig(): Promise<Readonly<Record<string, unknown>>> {
		if (typeof this.#npmConfig === "undefined") {
			const {
				stderr,
				stdout,
				success
			}: Deno.CommandOutput = await this.constructCommand(["npm", "config", "ls", "--json"]).output();
			if (!success) {
				return logError(`Unable to get NPM config: ${new TextDecoder().decode(stderr)}`);
			}
			this.#npmConfig = JSON.parse(new TextDecoder().decode(stdout)) as Record<string, unknown>;
		}
		return this.#npmConfig;
	}
	async getNPMConfigRegistry(): Promise<string> {
		if (typeof this.#registryNPMConfig === "undefined") {
			const npmConfig = await this.getNPMConfig();
			const {
				hostname,
				pathname
			}: URL = new URL(npmConfig.registry as string);
			this.#registryNPMConfig = `${hostname}${(pathname === "/") ? "" : pathname}`;
		}
		return this.#registryNPMConfig;
	}
	async getPackageManifest(): Promise<Readonly<Record<string, unknown>>> {
		if (typeof this.#packageManifest === "undefined") {
			try {
				this.#packageManifest = JSON.parse(await Deno.readTextFile(normalizePath(joinPath(this.#cwd, "package.json")))) as Record<string, unknown>;
			} catch (error) {
				return logError(`Unable to get package manifest: ${error}`);
			}
		}
		return this.#packageManifest;
	}
	async getPackageMeta(): Promise<Readonly<Record<string, unknown>> | undefined> {
		if (typeof this.#packageMeta === "undefined") {
			const npmRegistryFetchOptions: npmRegistryFetch.Options = {
				...await this.getNPMConfig()
			};
			if (typeof this.#registryInput !== "undefined") {
				npmRegistryFetchOptions.registry = `https://${this.#registryInput}/`;
			}
			try {
				this.#packageMeta = await npmRegistryFetch.json(`/${await this.getPackageName()}`, npmRegistryFetchOptions);
			} catch (error) {
				logWarn(`Unable to get package meta: ${error}`);
			}
		}
		return this.#packageMeta;
	}
	async getPackageName(): Promise<string> {
		if (typeof this.#packageName === "undefined") {
			try {
				this.#packageName = (await this.getPackageManifest()).name as string;
			} catch (error) {
				return logError(`Unable to get package name: ${error}`);
			}
		}
		return this.#packageName;
	}
	async getPackageVersion(): Promise<SemVer> {
		if (typeof this.#packageVersion === "undefined") {
			let packageVersionString: string;
			try {
				packageVersionString = (await this.getPackageManifest()).version as string;
			} catch (error) {
				return logError(`Unable to get package version: ${error}`);
			}
			try {
				this.#packageVersion = parseSemVer(packageVersionString);
			} catch {
				return logError(`\`${packageVersionString}\` is not a valid semantic version.`);
			}
		}
		return this.#packageVersion;
	}
	async getRegistry(): Promise<string> {
		if (typeof this.#registryInput !== "undefined") {
			return this.#registryInput;
		}
		return await this.getNPMConfigRegistry();
	}
	async isPackageVersionNonLatest(): Promise<boolean> {
		const packageVersion: SemVer = await this.getPackageVersion();
		const packageMeta: Readonly<Record<string, unknown>> | undefined = await this.getPackageMeta();
		if (
			typeof packageMeta === "undefined" ||
			typeof packageMeta.versions === "undefined"
		) {
			return false;
		}
		const versionPublished: readonly SemVer[] = Object.keys(packageMeta.versions as Record<string, unknown>).map((version: string): SemVer => {
			return parseSemVer(version);
		});
		const versionHighest: SemVer = [...versionPublished, packageVersion].sort(compareSemVer).reverse()[0];
		return !areSemVersEqual(packageVersion, versionHighest);
	}
	async setToken(token: string): Promise<void> {
		const key: string = `//${await this.getRegistry()}/:_authToken`;
		const {
			stderr,
			success
		}: Deno.CommandOutput = await this.constructCommand(["npm", "config", "set", key, token]).output();
		if (!success) {
			return logError(new TextDecoder().decode(stderr));
		}
		this.#tokenCleanupKey = key;
	}
	async removeToken(): Promise<void> {
		if (this.#tokenCleanupKey !== null) {
			const {
				stderr,
				success
			}: Deno.CommandOutput = await agent.constructCommand(["npm", "config", "delete", this.#tokenCleanupKey]).output();
			if (!success) {
				logWarn(new TextDecoder().decode(stderr));
			}
		}
	}
	async publishCheck(): Promise<void> {
		const packageName: string = await this.getPackageName();
		const packageVersion: string = stringifySemVer(await this.getPackageVersion());
		const env: Record<string, string> = {
			NPM_CONFIG_PROVENANCE: "false"
		};
		if (typeof this.#registryInput !== "undefined") {
			env.NPM_CONFIG_REGISTRY = `https://${this.#registryInput}/`;
		}
		const {
			stderr,
			stdout,
			success
		}: Deno.CommandOutput = await this.constructCommand(["npm", "publish", "--dry-run"], { env }).output();
		const stdoutString: string = new TextDecoder().decode(stdout);
		if (stdoutString.length > 0) {
			console.log(stdoutString);
		}
		if (!success) {
			const stderrString: string = new TextDecoder().decode(stderr);
			if (this.#checkBypass && stderrString.includes("You cannot publish over the previously published versions: ")) {
				logWarn(`\`${packageName}@${packageVersion}\` is already published; Remember to update the package version before publish.`);
			} else if (this.#checkBypass && stderrString.includes("You must specify a tag using --tag when publishing a prerelease version.")) {
				logInfo(`\`${packageName}@${packageVersion}\` is a pre-release; Tag will correctly handle during publish.`);
			} else {
				return logError(stderrString);
			}
		}
	}
	async publishDeploy(): Promise<void> {
		const envCommon: Record<string, string> = {};
		if (
			((await this.getPackageVersion()).prerelease ?? []).length > 0 ||
			await this.isPackageVersionNonLatest()
		) {
			envCommon.NPM_CONFIG_TAG = this.#tagNonLatest;
		}
		if (this.#provenance) {
			const env: Record<string, string> = {
				...envCommon,
				NPM_CONFIG_PROVENANCE: "true"
			};
			if (typeof this.#registryInput !== "undefined") {
				env.NPM_CONFIG_REGISTRY = `https://${this.#registryInput}/`;
			}

			const {
				stderr,
				stdout,
				success
			}: Deno.CommandOutput = await this.constructCommand(["npm", "publish"], { env }).output();
			const stdoutString: string = new TextDecoder().decode(stdout);
			if (stdoutString.length > 0) {
				console.log(stdoutString);
			}
			if (success) {
				return;
			}
			const stderrString: string = new TextDecoder().decode(stderr);
			if (!this.#provenanceFallback) {
				return logError(stderrString);
			}
			logWarn(stderrString);
		}
		const env: Record<string, string> = {
			...envCommon,
			NPM_CONFIG_PROVENANCE: "false"
		};
		if (typeof this.#registryInput !== "undefined") {
			env.NPM_CONFIG_REGISTRY = `https://${this.#registryInput}/`;
		}
		const {
			stderr,
			stdout,
			success
		}: Deno.CommandOutput = await this.constructCommand(["npm", "publish"], { env }).output();
		const stdoutString: string = new TextDecoder().decode(stdout);
		if (stdoutString.length > 0) {
			console.log(stdoutString);
		}
		if (success) {
			return;
		}
		return logError(new TextDecoder().decode(stderr));
	}
}
const args = parseArgs(Deno.args, {
	"--": true,
	boolean: [
		"dry-run",
		"no-check-bypass",
		"no-provenance-fallback"
	],
	string: [
		"provenance",
		"registry",
		"tag-non-latest",
		"token",
		"workspace"
	]
});
const agent: NPPAgent = new NPPAgent({
	checkBypass: !args["no-check-bypass"],
	provenance: args.provenance,
	provenanceFallback: !args["no-provenance-fallback"],
	registry: args.registry,
	tagNonLatest: args["tag-non-latest"],
	workspace: args.workspace
});
try {
	if (typeof args.token !== "undefined") {
		await agent.setToken(args.token);
	}
	if (args["dry-run"]) {
		await agent.publishCheck();
	} else {
		await agent.publishDeploy();
	}
} finally {
	await agent.removeToken();
}
