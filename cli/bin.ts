import { runCli } from "./cli";

runCli(process.argv.slice(2), {
	writeStderr: (text) => process.stderr.write(text),
}).then((result) => {
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exitCode = result.exitCode;
}).catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 2;
});
