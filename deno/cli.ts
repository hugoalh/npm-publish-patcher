import { parseArgs } from "jsr:@std/cli@^1.0.32/parse-args";
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
interface NPPAgentCommandOutput extends Deno.CommandStatus {
	stderr: string;
	stdout: string;
}
class NPPAgent {
	#checkBypass: boolean;
	#commandEnv: Record<string, string> = {};
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
		if (typeof registry !== "undefined") {
			this.#commandEnv.NPM_CONFIG_REGISTRY = `https://${registry}/`;
			this.#registryInput = registry;
		}
		if (typeof workspace === "undefined") {
			this.#cwd = Deno.cwd();
		} else if (isPathAbsolute(workspace)) {
			this.#cwd = workspace;
		} else {
			this.#cwd = normalizePath(joinPath(Deno.cwd(), workspace));
		}
		this.#checkBypass = checkBypass;
		this.#provenance = resolveProvenanceStatus(provenance);
		this.#provenanceFallback = provenanceFallback;
		this.#tagNonLatest = tagNonLatest;
	}
	async executeCommand(command: readonly string[], options: NPPAgentCommandOptions = {}): Promise<NPPAgentCommandOutput> {
		const {
			clearEnv,
			detached,
			env = {},
			...optionsRest
		}: NPPAgentCommandOptions = options;
		const {
			stderr,
			stdout,
			...commandStatus
		}: Deno.CommandOutput = await new Deno.Command(command[0], {
			...optionsRest,
			args: command.slice(1),
			clearEnv: clearEnv ?? false,
			cwd: this.#cwd,
			detached: detached ?? false,
			env: {
				...env,
				...this.#commandEnv,
				NPM_CONFIG_ALLOW_GIT: "none",
				NPM_CONFIG_ALLOW_REMOTE: "none",
				NPM_CONFIG_FUND: "false",
				NPM_CONFIG_GIT_TAG_VERSION: "false",
				NPM_CONFIG_PROGRESS: "false",
				NPM_CONFIG_UNICODE: "true",
				NPM_CONFIG_UPDATE_NOTIFIER: "false"
			}
		}).output();
		return {
			...commandStatus,
			stderr: new TextDecoder().decode(stderr).trimEnd(),
			stdout: new TextDecoder().decode(stdout).trimEnd()
		};
	}
	async getNPMConfig(): Promise<Readonly<Record<string, unknown>>> {
		if (typeof this.#npmConfig === "undefined") {
			const {
				stderr,
				stdout,
				success
			}: NPPAgentCommandOutput = await this.executeCommand(["npm", "config", "ls", "--json"]);
			if (!success) {
				return logError(`Unable to get NPM config: ${stderr}`);
			}
			this.#npmConfig = JSON.parse(stdout) as Record<string, unknown>;
		}
		return this.#npmConfig;
	}
	async getNPMConfigRegistry(): Promise<string> {
		if (typeof this.#registryNPMConfig === "undefined") {
			const npmConfig: Readonly<Record<string, unknown>> = await this.getNPMConfig();
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
	async getPackageManifestName(): Promise<string> {
		this.#packageName ??= (await this.getPackageManifest()).name as string;
		return this.#packageName;
	}
	async getPackageManifestVersion(): Promise<SemVer> {
		if (typeof this.#packageVersion === "undefined") {
			const packageVersionString: string = (await this.getPackageManifest()).version as string;
			try {
				this.#packageVersion = parseSemVer(packageVersionString);
			} catch {
				return logError(`\`${packageVersionString}\` is not a valid semantic version.`);
			}
		}
		return this.#packageVersion;
	}
	async getPackageRegistryMeta(): Promise<Readonly<Record<string, unknown>> | undefined> {
		if (typeof this.#packageMeta === "undefined") {
			const packageName: string = await this.getPackageManifestName();
			try {
				const {
					stderr,
					stdout,
					success
				}: NPPAgentCommandOutput = await this.executeCommand(["npm", "view", packageName, "--json"]);
				if (success) {
					try {
						this.#packageMeta = JSON.parse(stdout) as Readonly<Record<string, unknown>>;
					} catch (error) {
						logWarn(`Unable to parse package registry meta: ${error}`);
						logInfo(`Raw Package Registry Meta:\n${stdout}`);
					}
				} else {
					logWarn(`Unable to get package registry meta: ${stderr}`);
				}
			} catch (error) {
				logWarn(`Unable to get package registry meta: ${error}`);
			}
		}
		return this.#packageMeta;
	}
	async getRegistry(): Promise<string> {
		if (typeof this.#registryInput !== "undefined") {
			return this.#registryInput;
		}
		return await this.getNPMConfigRegistry();
	}
	async isPackageVersionNonLatest(): Promise<boolean> {
		const versionCurrent: SemVer = await this.getPackageManifestVersion();
		const meta: Readonly<Record<string, unknown>> | undefined = await this.getPackageRegistryMeta();
		if (
			typeof meta === "undefined" ||
			typeof meta.versions === "undefined"
		) {
			return false;
		}
		const versionPublished: readonly SemVer[] = (meta.versions as string[]).map((version: string): SemVer => {
			return parseSemVer(version);
		});
		const versionHighest: SemVer = [...versionPublished, versionCurrent].sort(compareSemVer).at(-1)!;
		return !areSemVersEqual(versionCurrent, versionHighest);
	}
	async setToken(token: string): Promise<void> {
		const key: string = `//${await this.getRegistry()}/:_authToken`;
		const {
			stderr,
			success
		}: NPPAgentCommandOutput = await this.executeCommand(["npm", "config", "set", key, token]);
		if (!success) {
			return logError(`Unable to set token: ${stderr}`);
		}
		this.#tokenCleanupKey = key;
	}
	async removeToken(): Promise<void> {
		if (this.#tokenCleanupKey !== null) {
			const { stderr }: NPPAgentCommandOutput = await this.executeCommand(["npm", "config", "delete", this.#tokenCleanupKey]);
			if (stderr.length > 0) {
				console.log(stderr);
			}
		}
	}
	async publishCheck(): Promise<void> {
		const packageName: string = await this.getPackageManifestName();
		const packageVersion: SemVer = await this.getPackageManifestVersion();
		const {
			stderr,
			stdout,
			success
		}: NPPAgentCommandOutput = await this.executeCommand(["npm", "publish", "--dry-run"], {
			env: {
				NPM_CONFIG_PROVENANCE: "false"
			}
		});
		if (stdout.length > 0) {
			console.log(stdout);
		}
		if (stderr.length > 0) {
			console.log(stderr);
		}
		if (success) {
			return;
		}
		if (this.#checkBypass && stderr.includes("You cannot publish over the previously published versions: ")) {
			logWarn(`\`${packageName}@${stringifySemVer(packageVersion)}\` is already published; Remember to update the package version before publish.`);
		} else if (this.#checkBypass && stderr.includes("You must specify a tag using --tag when publishing a prerelease version.")) {
			logInfo(`\`${packageName}@${stringifySemVer(packageVersion)}\` is a pre-release; Tag will correctly handle during publish.`);
		} else {
			return logError(`Unable to check package publish!`);
		}
	}
	async publishDeploy(): Promise<void> {
		const commandEnvCommon: Record<string, string> = {};
		if (
			((await this.getPackageManifestVersion()).prerelease ?? []).length > 0 ||
			await this.isPackageVersionNonLatest()
		) {
			commandEnvCommon.NPM_CONFIG_TAG = this.#tagNonLatest;
		}
		if (this.#provenance) {
			const {
				stderr,
				stdout,
				success
			}: NPPAgentCommandOutput = await this.executeCommand(["npm", "publish"], {
				env: {
					...commandEnvCommon,
					NPM_CONFIG_PROVENANCE: "true"
				}
			});
			if (stdout.length > 0) {
				console.log(stdout);
			}
			if (stderr.length > 0) {
				console.log(stderr);
			}
			if (success) {
				return;
			}
			if (!this.#provenanceFallback) {
				return logError(`Unable to publish package with provenance!`);
			}
			logWarn(`Unable to publish package with provenance! Will fallback to publish package without provenance.`);
		}
		const {
			stderr,
			stdout,
			success
		}: NPPAgentCommandOutput = await this.executeCommand(["npm", "publish"], {
			env: {
				...commandEnvCommon,
				NPM_CONFIG_PROVENANCE: "false"
			}
		});
		if (stdout.length > 0) {
			console.log(stdout);
		}
		if (stderr.length > 0) {
			console.log(stderr);
		}
		if (success) {
			return;
		}
		return logError(`Unable to publish package!`);
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
