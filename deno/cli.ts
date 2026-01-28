import { parseArgs } from "jsr:@std/cli@^1.0.25/parse-args";
import {
	isAbsolute as isPathAbsolute,
	join as joinPath
} from "node:path";
import yoctocolors from "npm:yoctocolors@^2.1.2";
if (!import.meta.main) {
	throw new Error(`This entrypoint is for command line only!`);
}
interface NPPParameters {
	cwd: string | undefined;
}
interface NPPDataParameters extends NPPParameters {
	cleanup: boolean;
	registry: string | undefined;
	token: string | undefined;
}
interface NPPPublishParameters extends NPPParameters {
	extras: string[];
}
interface NPPPublishCheckParameters extends NPPPublishParameters {
	ignorePPV: boolean;
}
interface NPPPublishDeployParameters extends NPPPublishParameters {
	provenance: boolean;
}
const cleanupDataKeys: string[] = [];
function logError(message: string): void {
	console.error(`${yoctocolors.red("ERR")} \t${message}`);
	throw new Error(message);
}
function logWarn(message: string): void {
	console.warn(`${yoctocolors.yellow("WARN")}\t${message}`);
}
function constructCommmand(command: readonly string[], options?: Omit<Deno.CommandOptions, "args">): Deno.Command {
	return new Deno.Command(command[0], {
		...options,
		args: command.slice(1)
	});
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
function resolveWorkspace(input: string | undefined): string | undefined {
	if (typeof input === "undefined") {
		return;
	}
	if (isPathAbsolute(input)) {
		return input;
	}
	return joinPath(Deno.cwd(), input);
}
async function invokeNPMPublishCheck({
	cwd,
	extras,
	ignorePPV
}: NPPPublishCheckParameters): Promise<void> {
	const command: Deno.Command = constructCommmand(["npm", "publish", "--dry-run", ...extras], { cwd });
	const result0: Deno.CommandOutput = await command.output();
	const result0StdOut: string = new TextDecoder().decode(result0.stdout);
	if (result0StdOut.length > 0) {
		console.log(result0StdOut);
	}
	if (result0.success) {
		return;
	}
	const result0StdErr: string = new TextDecoder().decode(result0.stderr);
	if (ignorePPV && result0StdErr.includes("error You cannot publish over the previously published versions:")) {
		logWarn(result0StdErr);
	} else {
		throw logError(result0StdErr);
	}
	const manifestPath: string = joinPath(cwd ?? Deno.cwd(), "package.json");
	const manifestContext: Uint8Array = await Deno.readFile(manifestPath);
	const result1: Deno.CommandOutput = await constructCommmand(["npm", "version", "999999.999999.999999"], { cwd }).output();
	if (!result1.success) {
		throw logError(new TextDecoder().decode(result1.stderr));
	}
	try {
		const result2: Deno.CommandOutput = await command.output();
		const result2StdOut: string = new TextDecoder().decode(result2.stdout);
		if (result2StdOut.length > 0) {
			console.log(result2StdOut);
		}
		if (result2.success) {
			return;
		}
		throw logError(new TextDecoder().decode(result2.stderr));
	} finally {
		await Deno.writeFile(manifestPath, manifestContext, { create: false });
	}
}
async function invokeNPMPublishDeploy({
	cwd,
	extras,
	provenance
}: NPPPublishDeployParameters): Promise<void> {
	if (provenance) {
		const result: Deno.CommandOutput = await constructCommmand(["npm", "publish", "--provenance", ...extras], { cwd }).output();
		const resultStdOut: string = new TextDecoder().decode(result.stdout);
		if (resultStdOut.length > 0) {
			console.log(resultStdOut);
		}
		if (result.success) {
			return;
		}
		logWarn(new TextDecoder().decode(result.stderr));
	}
	const result: Deno.CommandOutput = await constructCommmand(["npm", "publish", ...extras], { cwd }).output();
	const resultStdOut: string = new TextDecoder().decode(result.stdout);
	if (resultStdOut.length > 0) {
		console.log(resultStdOut);
	}
	if (result.success) {
		return;
	}
	throw logError(new TextDecoder().decode(result.stderr));
}
async function invokeNPMSetData({
	cleanup,
	cwd,
	registry,
	token
}: NPPDataParameters): Promise<void> {
	if (typeof registry !== "undefined") {
		const resultSetRegistry: Deno.CommandOutput = await constructCommmand(["npm", "config", "set", "registry", `https://${registry}/`], { cwd }).output();
		if (!resultSetRegistry.success) {
			throw logError(new TextDecoder().decode(resultSetRegistry.stderr));
		}
		if (cleanup) {
			cleanupDataKeys.unshift("registry");
		}
	}
	if (typeof token !== "undefined") {
		const key: string = `//${registry ?? "registry.npmjs.org"}/:_authToken`;
		const resultSetToken: Deno.CommandOutput = await constructCommmand(["npm", "config", "set", key, token], { cwd }).output();
		if (!resultSetToken.success) {
			throw logError(new TextDecoder().decode(resultSetToken.stderr));
		}
		if (cleanup) {
			cleanupDataKeys.unshift(key);
		}
	}
}
const args = parseArgs(Deno.args, {
	"--": true,
	boolean: [
		"cleanup",
		"dry-run",
		"ignore-ppv"
	],
	string: [
		"cwd",
		"provenance",
		"registry",
		"token"
	]
});
const cwd: string | undefined = resolveWorkspace(args.cwd);
const dryrun: boolean = args["dry-run"];
const ignorePPV: boolean = args["ignore-ppv"];
if (!dryrun && ignorePPV) {
	throw logError(`Ignore the error of "previously published versions" is only possible during publish check.`);
}
try {
	await invokeNPMSetData({
		cleanup: args.cleanup,
		cwd,
		registry: args.registry,
		token: args.token
	});
	if (dryrun) {
		await invokeNPMPublishCheck({
			cwd,
			extras: args["--"],
			ignorePPV
		});
	} else {
		await invokeNPMPublishDeploy({
			cwd,
			extras: args["--"],
			provenance: resolveProvenanceStatus(args.provenance)
		});
	}
} finally {
	if (cleanupDataKeys.length > 0) {
		const resultCleanup: Deno.CommandOutput = await constructCommmand(["npm", "config", "delete", ...cleanupDataKeys], { cwd }).output();
		if (!resultCleanup.success) {
			logWarn(new TextDecoder().decode(resultCleanup.stderr));
		}
	}
}
