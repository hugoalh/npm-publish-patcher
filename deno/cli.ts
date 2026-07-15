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
type NPPAgentCommandOptions = Omit<Deno.CommandOptions, "args" | "clearEnv" | "cwd" | "detached">;
interface NPPAgentCommandOutput extends Deno.CommandStatus {
	stderr: string;
	stdout: string;
}
class NPPAgent {
	#allowFoolishErrors: boolean;
	#commandEnv: Record<string, string> = {};
	#cwd: string;
	#dryRun: boolean;
	#packageManifest?: Readonly<Record<string, unknown>>;
	#packageName?: string;
	#packageRegistryMeta?: Readonly<Record<string, unknown>>;
	#packageVersion?: SemVer;
	#provenance: boolean;
	#stage: boolean;
	#tagCurrent?: string;
	#tagNonLatest: string;
	#tokenKey?: string;
	#token?: string;
	async [Symbol.asyncDispose](): Promise<void> {
		if (typeof this.#tokenKey !== "undefined") {
			const { stderr }: NPPAgentCommandOutput = await this.#executeCommand(["npm", "config", "delete", this.#tokenKey]);
			if (stderr.length > 0) {
				console.log(stderr);
			}
		}
	}
	constructor() {
		const args = parseArgs(Deno.args, {
			"--": true,
			boolean: [
				"allow-foolish-errors",
				"dry-run",
				"provenance",
				"stage"
			],
			string: [
				"registry",
				"tag-current",
				"tag-non-latest",
				"token",
				"workspace"
			]
		});
		this.#allowFoolishErrors = args["allow-foolish-errors"];
		this.#cwd = (typeof args.workspace === "undefined") ? Deno.cwd() : (
			isPathAbsolute(args.workspace) ? args.workspace : normalizePath(joinPath(Deno.cwd(), args.workspace))
		);
		this.#dryRun = args["dry-run"];
		this.#provenance = args.provenance;
		if (typeof args.registry !== "undefined") {
			this.#commandEnv.NPM_CONFIG_REGISTRY = `https://${args.registry}/`;
		}
		this.#stage = args.stage;
		this.#tagCurrent = args["tag-current"];
		this.#tagNonLatest = args["tag-non-latest"] ?? "recent";
		this.#token = args.token;
	}
	async execute(): Promise<void> {
		if (typeof this.#token !== "undefined") {
			this.#tokenKey = `//${await this.#getNPMConfigRegistry()}/:_authToken`;
			let value: string;
			if (this.#token.startsWith("#")) {
				value = `\${${this.#token.slice(1)}}`;
			} else if (this.#token.startsWith("^")) {
				value = Deno.env.get(this.#token.slice(1)) ?? "";
			} else {
				value = this.#token;
			}
			if (value.length > 0) {
				const {
					stderr,
					success
				}: NPPAgentCommandOutput = await this.#executeCommand(["npm", "config", "set", this.#tokenKey, value]);
				if (!success) {
					return logError(`Unable to set token: ${stderr}`);
				}
			}
		}
		if (this.#dryRun) {
			await this.#publishCheck();
		} else {
			await this.#publishDeploy();
		}
	}
	async #executeCommand(command: readonly string[], options: NPPAgentCommandOptions = {}): Promise<NPPAgentCommandOutput> {
		const {
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
			clearEnv: false,
			cwd: this.#cwd,
			detached: false,
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
	async #getNPMConfig(key: string): Promise<string> {
		const {
			stderr,
			stdout,
			success
		}: NPPAgentCommandOutput = await this.#executeCommand(["npm", "config", "get", key]);
		if (!success) {
			return logError(`Unable to get NPM config \`${key}\`: ${stderr}`);
		}
		return stdout;
	}
	async #getNPMConfigRegistry(): Promise<string> {
		const {
			hostname,
			pathname
		}: URL = new URL(await this.#getNPMConfig("registry"));
		const result: string = `${hostname}${pathname}`;
		return (result.endsWith("/") ? result.slice(0, -1) : result);
	}
	async #getPackageManifest(): Promise<Readonly<Record<string, unknown>>> {
		if (typeof this.#packageManifest === "undefined") {
			try {
				this.#packageManifest = JSON.parse(await Deno.readTextFile(normalizePath(joinPath(this.#cwd, "package.json")))) as Record<string, unknown>;
			} catch (error) {
				return logError(`Unable to get package manifest: ${error}`);
			}
		}
		return this.#packageManifest;
	}
	async #getPackageManifestName(): Promise<string> {
		this.#packageName ??= (await this.#getPackageManifest()).name as string;
		return this.#packageName;
	}
	async #getPackageManifestVersion(): Promise<SemVer> {
		if (typeof this.#packageVersion === "undefined") {
			const packageVersionString: string = (await this.#getPackageManifest()).version as string;
			try {
				this.#packageVersion = parseSemVer(packageVersionString);
			} catch {
				return logError(`\`${packageVersionString}\` is not a valid semantic version.`);
			}
		}
		return this.#packageVersion;
	}
	async #getPackageRegistryMeta(): Promise<Readonly<Record<string, unknown>> | undefined> {
		if (typeof this.#packageRegistryMeta === "undefined") {
			const packageName: string = await this.#getPackageManifestName();
			try {
				const {
					stderr,
					stdout,
					success
				}: NPPAgentCommandOutput = await this.#executeCommand(["npm", "view", packageName, "--json"]);
				if (success) {
					try {
						this.#packageRegistryMeta = JSON.parse(stdout) as Readonly<Record<string, unknown>>;
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
		return this.#packageRegistryMeta;
	}
	async #isPackageVersionNotLatest(): Promise<boolean> {
		const versionCurrent: SemVer = await this.#getPackageManifestVersion();
		const meta: Readonly<Record<string, unknown>> | undefined = await this.#getPackageRegistryMeta();
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
	async #publishCheck(): Promise<void> {
		const packageName: string = await this.#getPackageManifestName();
		const packageVersion: SemVer = await this.#getPackageManifestVersion();
		const {
			stderr,
			stdout,
			success
		}: NPPAgentCommandOutput = await this.#executeCommand(["npm", "publish", "--dry-run"], {
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
		let errorLast: boolean = false;
		if (!success) {
			if (!this.#allowFoolishErrors && stderr.includes("You cannot publish over the previously published versions: ")) {
				logWarn(`\`${packageName}@${stringifySemVer(packageVersion)}\` is already published; Remember to update the package version before publish.`);
			} else if (!this.#allowFoolishErrors && stderr.includes("You must specify a tag using --tag when publishing a prerelease version.")) {
				logInfo(`\`${packageName}@${stringifySemVer(packageVersion)}\` is a pre-release; Tag will correctly handle during publish.`);
			} else {
				errorLast = true;
			}
		}
		if (typeof this.#tagCurrent !== "undefined") {
			logInfo(`Tag: \`${this.#tagCurrent}\`.`);
		} else if (
			(packageVersion.prerelease ?? []).length > 0 ||
			await this.#isPackageVersionNotLatest()
		) {
			logInfo(`Tag: \`${this.#tagNonLatest}\`.`);
		} else {
			logInfo(`Tag: \`${await this.#getNPMConfig("tag")}\`.`);
		}
		if (errorLast) {
			return logError(`Unable to check package publish!`);
		}
	}
	async #publishDeploy(): Promise<void> {
		const commandEnvCommon: Record<string, string> = {};
		if (this.#provenance) {
			commandEnvCommon.NPM_CONFIG_PROVENANCE = "true";
		}
		if (typeof this.#tagCurrent !== "undefined") {
			commandEnvCommon.NPM_CONFIG_TAG = this.#tagCurrent;
		} else if (
			((await this.#getPackageManifestVersion()).prerelease ?? []).length > 0 ||
			await this.#isPackageVersionNotLatest()
		) {
			commandEnvCommon.NPM_CONFIG_TAG = this.#tagNonLatest;
		}
		const {
			stderr,
			stdout,
			success
		}: NPPAgentCommandOutput = await this.#executeCommand(this.#stage ? ["npm", "stage", "publish"] : ["npm", "publish"], {
			env: commandEnvCommon
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
await using agent: NPPAgent = new NPPAgent();
await agent.execute();
