import { runCli } from "./cli";

runCli(process.argv.slice(2), {
	writeStderr: (text) => process.stderr.write(text),
}).then((result) => {
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exitCode = result.exitCode;
});
