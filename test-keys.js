import { execSync } from "child_process";

function fetchHistory() {
	const formatStr = "{time}\t{exit}\t{command}";
	const stdout = execSync(
		`atuin search --cwd . --limit 100 --format "${formatStr}" --print0`,
		{ encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
	);
	const entries = [];
	const rawEntries = stdout.split("\0");
	for (const raw of rawEntries) {
		if (!raw.trim()) continue;
		const firstTab = raw.indexOf("\t");
		const secondTab = raw.indexOf("\t", firstTab + 1);
		if (firstTab === -1 || secondTab === -1) continue;
		entries.push({ command: raw.substring(secondTab + 1).trim() });
	}
	return entries;
}

const entries = fetchHistory();
console.log(entries.map(e => e.command).slice(0, 10));
