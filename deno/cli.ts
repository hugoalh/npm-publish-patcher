import { compare as compareSemVer } from "jsr:@std/semver@^1.0.8/compare";
import { equals as areSemVersEqual } from "jsr:@std/semver@^1.0.8/equals";
import { format as stringifySemVer } from "jsr:@std/semver@^1.0.8/format";
import { parse as parseSemVer } from "jsr:@std/semver@^1.0.8/parse";
import { tryParse as parseSemVerSafe } from "jsr:@std/semver@^1.0.8/try-parse";
import type { SemVer } from "jsr:@std/semver@^1.0.8/types";
import {
	isAbsolute as isPathAbsolute,
	join as joinPath,
	normalize as normalizePath
} from "node:path";
import { exit } from "node:process";
import {
	parseArgs,
	styleText
} from "node:util";
if (!import.meta.main) {
	throw new Error(`This entrypoint is for command line only!`);
}
addEventListener("unhandledrejection", (event: PromiseRejectionEvent): void => {
	event.preventDefault();
	let message: string;
	if (event.reason instanceof Error) {
		message = event.reason.message;
		if ((event.reason.stack ?? "").length > 0) {
			message += `\n${event.reason.stack}`;
		}
	} else {
		message = String(event.reason);
	}
	console.error(`${styleText(["red"], "ERROR", { validateStream: false })}\t${message}`);
	exit(1);
}, { capture: true });
function logInfo(message: string): void {
	console.info(`${styleText(["blue"], "INFO", { validateStream: false })}\t${message}`);
}
function logWarn(message: string): void {
	console.warn(`${styleText(["yellow"], "WARN", { validateStream: false })}\t${message}`);
}
type NPPAgentCommandOptions = Omit<Deno.CommandOptions, "args" | "clearEnv" | "detached">;
interface NPPAgentCommandOutput extends Deno.CommandStatus {
	stderr: string;
	stdout: string;
}
class NPPAgent {
	#allowFoolishErrors: boolean;
	#commandEnv: Record<string, string> = {};
	#dataGitTags: boolean;
	#dryRun: boolean;
	#packageManifest?: Readonly<Record<string, unknown>>;
	#packageName?: string;
	#packageRegistryMeta?: Readonly<Record<string, unknown>>;
	#packageVersion?: SemVer;
	#pathWorkspace: string;
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
		const { values } = parseArgs({
			options: {
				"allow-foolish-errors": {
					type: "boolean"
				},
				"data-git-tags": {
					type: "boolean"
				},
				"dry-run": {
					type: "boolean"
				},
				"provenance": {
					type: "boolean"
				},
				"registry": {
					type: "string"
				},
				"stage": {
					type: "boolean"
				},
				"tag-current": {
					type: "string"
				},
				"tag-non-latest": {
					type: "string"
				},
				"token": {
					type: "string"
				},
				"workspace": {
					type: "string"
				}
			}
		});
		this.#allowFoolishErrors = values["allow-foolish-errors"] ?? false;
		this.#dataGitTags = values["data-git-tags"] ?? false;
		this.#dryRun = values["dry-run"] ?? false;
		this.#pathWorkspace = (typeof values.workspace === "undefined") ? Deno.cwd() : (
			isPathAbsolute(values.workspace) ? values.workspace : normalizePath(joinPath(Deno.cwd(), values.workspace))
		);
		this.#provenance = values.provenance ?? false;
		if (typeof values.registry !== "undefined") {
			this.#commandEnv.NPM_CONFIG_REGISTRY = `https://${values.registry}/`;
		}
		this.#stage = values.stage ?? false;
		this.#tagCurrent = values["tag-current"];
		this.#tagNonLatest = values["tag-non-latest"] ?? "recent";
		this.#token = values.token;
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
					throw new Error(`Unable to set token: ${stderr}`);
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
			cwd,
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
			cwd: cwd ?? this.#pathWorkspace,
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
	async #getGitTags(): Promise<SemVer[] | undefined> {
		try {
			const {
				stderr,
				stdout,
				success
			}: NPPAgentCommandOutput = await this.#executeCommand(["git", "--no-pager", "tag", "--list"], { cwd: Deno.cwd() });
			if (success) {
				try {
					return stdout.split("\n").map((value: string): string => {
						return value.trim();
					}).filter((value: string): boolean => {
						return (value.length > 0);
					}).map((tag: string): SemVer | undefined => {
						return (parseSemVerSafe(tag) ?? (tag.startsWith("v") ? parseSemVerSafe(tag.slice(1)) : undefined));
					}).filter((tag: SemVer | undefined): tag is SemVer => {
						return (typeof tag !== "undefined");
					});
				} catch (error) {
					logWarn(`Unable to parse Git tags: ${error}`);
				}
			} else {
				logWarn(`Unable to get Git tags: ${stderr}`);
			}
		} catch (error) {
			logWarn(`Unable to get Git tags: ${error}`);
		}
		return undefined;
	}
	async #getNPMConfig(key: string): Promise<string> {
		const {
			stderr,
			stdout,
			success
		}: NPPAgentCommandOutput = await this.#executeCommand(["npm", "config", "get", key]);
		if (!success) {
			throw new Error(`Unable to get NPM config \`${key}\`: ${stderr}`);
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
				this.#packageManifest = JSON.parse(await Deno.readTextFile(normalizePath(joinPath(this.#pathWorkspace, "package.json")))) as Record<string, unknown>;
			} catch (error) {
				throw new Error(`Unable to get package manifest: ${error}`);
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
				throw new Error(`\`${packageVersionString}\` is not a valid semantic version.`);
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
	async #getPackageRegistryMetaVersions(): Promise<SemVer[] | undefined> {
		const meta: Readonly<Record<string, unknown>> | undefined = await this.#getPackageRegistryMeta();
		if (
			typeof meta === "undefined" ||
			typeof meta.versions === "undefined"
		) {
			return undefined;
		}
		try {
			return (meta.versions as readonly string[]).map((version: string): SemVer => {
				return parseSemVer(version);
			});
		} catch (error) {
			logWarn(`Unable to parse package registry meta versions: ${error}`);
		}
		return undefined;
	}
	async #isPackageVersionNonLatest(): Promise<boolean> {
		const versionCurrent: SemVer = await this.#getPackageManifestVersion();
		if ((versionCurrent.prerelease ?? []).length > 0) {
			return true;
		}
		if (this.#dataGitTags) {
			const versionsGitTag: readonly SemVer[] | undefined = await this.#getGitTags();
			if (typeof versionsGitTag !== "undefined") {
				return !areSemVersEqual(versionCurrent, [...versionsGitTag, versionCurrent].sort(compareSemVer).at(-1)!);
			}
		}
		const versionsRegistryMeta: readonly SemVer[] | undefined = await this.#getPackageRegistryMetaVersions();
		if (typeof versionsRegistryMeta !== "undefined") {
			return !areSemVersEqual(versionCurrent, [...versionsRegistryMeta, versionCurrent].sort(compareSemVer).at(-1)!);
		}
		logWarn(`Unable to determine package version is latest or non-latest.`);
		return false;
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
		} else if (await this.#isPackageVersionNonLatest()) {
			logInfo(`Tag: \`${this.#tagNonLatest}\`.`);
		} else {
			logInfo(`Tag: \`${await this.#getNPMConfig("tag")}\`.`);
		}
		if (errorLast) {
			throw new Error(`Unable to check package publish!`);
		}
	}
	async #publishDeploy(): Promise<void> {
		const commandEnvCommon: Record<string, string> = {};
		if (this.#provenance) {
			commandEnvCommon.NPM_CONFIG_PROVENANCE = "true";
		}
		if (typeof this.#tagCurrent !== "undefined") {
			commandEnvCommon.NPM_CONFIG_TAG = this.#tagCurrent;
		} else if (await this.#isPackageVersionNonLatest()) {
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
		throw new Error(`Unable to publish package!`);
	}
}
await using agent: NPPAgent = new NPPAgent();
await agent.execute();
