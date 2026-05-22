import { runCli } from "./cli";

runCli(process.argv.slice(2)).then((result) => {
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exitCode = result.exitCode;
});
