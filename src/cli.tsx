#!/usr/bin/env node
import "./env.js";

import { execSync } from "child_process";
import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useMemo, useState } from "react";

interface CommandEntry {
	time: number;
	exitCode: number;
	command: string;
	isAi: boolean;
}

function fetchHistory(): CommandEntry[] {
	const formatStr = "{time}\t{exit}\t{command}";
	const stdout = execSync(
		`atuin search --cwd . --limit 10000 --format "${formatStr}" --print0`,
		{
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		},
	);

	const entries: CommandEntry[] = [];
	const rawEntries = stdout.split("\0");

	for (const raw of rawEntries) {
		if (!raw.trim()) continue;
		const firstTab = raw.indexOf("\t");
		const secondTab = raw.indexOf("\t", firstTab + 1);

		if (firstTab === -1 || secondTab === -1) continue;

		const timeStr = raw.substring(0, firstTab).trim();
		const exitStr = raw.substring(firstTab + 1, secondTab).trim();
		const command = raw.substring(secondTab + 1).trim();

		const isAi = command.includes("#ai");
		let cleanCommand = command;
		if (isAi) {
			cleanCommand = cleanCommand.replace(/#ai\s*$/, "").trim();
			cleanCommand = cleanCommand
				.replace(/^export GIT_TERMINAL_PROMPT=0(?:\\n|\n)/, "")
				.trim();
		}

		entries.push({
			time: new Date(timeStr).getTime(),
			exitCode: parseInt(exitStr, 10),
			command: cleanCommand,
			isAi,
		});
	}

	entries.sort((a, b) => b.time - a.time);
	return entries;
}

function getGroupLength(cmdWords: string[], queryText: string): number {
	if (!queryText.trim()) return 1;

	const qWords = queryText.split(/\s+/);
	let exactMatches = 0;
	for (let i = 0; i < qWords.length; i++) {
		if (
			i < cmdWords.length &&
			qWords[i] !== "" &&
			qWords[i].toLowerCase() === cmdWords[i].toLowerCase()
		) {
			exactMatches++;
		} else {
			break;
		}
	}

	return Math.min(exactMatches + 1, cmdWords.length);
}

const App = ({
	history,
	initialQuery,
	onSelect,
}: {
	history: CommandEntry[];
	initialQuery: string;
	onSelect: (cmd: string) => void;
}) => {
	const { exit } = useApp();
	const [query, setQuery] = useState(initialQuery);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isExiting, setIsExiting] = useState(false);

	const items = useMemo(() => {
		const lowerQuery = query.toLowerCase();

		const normalizedCounts: Record<
			string,
			{ count: number; aiCount: number; paramCounts: Record<string, number> }
		> = {};

		for (let i = 0; i < history.length; i++) {
			const entry = history[i];
			if (entry.exitCode === 2 || entry.exitCode === 127) {
				continue;
			}

			if (lowerQuery && !entry.command.toLowerCase().includes(lowerQuery)) {
				continue;
			}

			const trimmed = entry.command.trim();
			const cmdWords = trimmed.split(/\s+/);
			if (cmdWords.length === 0 || !cmdWords[0]) continue;

			const numParts = getGroupLength(cmdWords, query);
			const normalizedCmd = cmdWords.slice(0, numParts).join(" ");

			let idx = 0;
			for (let j = 0; j < numParts; j++) {
				idx = trimmed.indexOf(cmdWords[j], idx) + cmdWords[j].length;
			}
			const params = trimmed.substring(idx).trim();

			if (!normalizedCounts[normalizedCmd]) {
				normalizedCounts[normalizedCmd] = {
					count: 0,
					aiCount: 0,
					paramCounts: {},
				};
			}

			normalizedCounts[normalizedCmd].count++;
			if (entry.isAi) {
				normalizedCounts[normalizedCmd].aiCount++;
			}

			if (params) {
				normalizedCounts[normalizedCmd].paramCounts[params] =
					(normalizedCounts[normalizedCmd].paramCounts[params] || 0) + 1;
			}
		}

		const sorted = Object.entries(normalizedCounts).sort(
			(a, b) => b[1].count - a[1].count,
		);
		const maxCount = sorted.length > 0 ? sorted[0][1].count : 0;

		return sorted.map(([cmd, stats]) => {
			const sortedParams = Object.entries(stats.paramCounts)
				.sort((a, b) => b[1] - a[1])
				.map((x) => x[0]);
			return {
				cmd,
				count: stats.count,
				aiCount: stats.aiCount,
				maxCount,
				params: sortedParams.join(", "),
			};
		});
	}, [history, query]);

	useInput((_input, key) => {
		if (key.upArrow) {
			setSelectedIndex(Math.max(0, selectedIndex - 1));
		} else if (key.downArrow) {
			setSelectedIndex(Math.min(items.length - 1, selectedIndex + 1));
		} else if (key.return) {
			const selected = items[selectedIndex];
			setIsExiting(true);
			exit();
			if (selected) {
				onSelect(selected.cmd);
			}
		} else if (key.escape) {
			setIsExiting(true);
			exit();
		}
	});

	if (isExiting) {
		return null;
	}

	let maxCmdLen = 10;
	for (const item of items) {
		if (item.cmd.length > maxCmdLen) {
			maxCmdLen = item.cmd.length;
		}
	}
	maxCmdLen = Math.min(maxCmdLen, 60);

	return (
		<Box flexDirection="column" padding={1} width="100%">
			<Box flexDirection="column" marginBottom={1}>
				<Text color="yellow" bold>
					🌟 Voyager Cheat Sheet (v1.0.1) 🌟
				</Text>
				<Box>
					<Text color="cyan">Search: </Text>
					<TextInput
						value={query}
						onChange={(q) => {
							setQuery(q);
							setSelectedIndex(0);
						}}
					/>
				</Box>
			</Box>

			<Box flexDirection="column" width="100%">
				<Box width="100%">
					<Text bold wrap="truncate">
						{`${"Command".padEnd(maxCmdLen + 2, " ")} | ${"Frequency".padEnd(20, " ")} | 🤖 AI | Count | Parameters`}
					</Text>
				</Box>
				<Box width="100%">
					<Text dimColor wrap="truncate">
						{`${"-".repeat(maxCmdLen + 3)}+${"-".repeat(22)}+-------+-------+------------`}
					</Text>
				</Box>

				{items.slice(0, 15).map((item, index) => {
					const isSelected = index === selectedIndex;
					const barLength =
						item.maxCount > 0
							? Math.round((item.count / item.maxCount) * 20)
							: 0;
					const aiBarLength =
						item.count > 0
							? Math.round((item.aiCount / item.count) * barLength)
							: 0;
					const manualBarLength = barLength - aiBarLength;
					const manualBarStr = "█".repeat(manualBarLength);
					const aiBarStr = "█".repeat(aiBarLength);
					const padStr = " ".repeat(20 - barLength);
					const aiTag =
						item.aiCount > 0
							? item.aiCount.toString().padStart(5, " ")
							: "     ";
					const countStr = item.count.toString().padStart(5, " ");
					const cmdStr = item.cmd
						.padEnd(maxCmdLen, " ")
						.substring(0, maxCmdLen);

					return (
						<Box key={item.cmd} width="100%">
							<Box flexShrink={0}>
								<Text
									color={isSelected ? "green" : undefined}
									bold={isSelected}
								>
									{isSelected ? "> " : "  "}
									{cmdStr} |
								</Text>
								<Text>
									{" "}
									<Text color="cyan">{manualBarStr}</Text>
									<Text color="magenta">{aiBarStr}</Text>
									{padStr}{" "}
								</Text>
								<Text color={isSelected ? "green" : undefined}>
									| {aiTag} | {countStr} |{" "}
								</Text>
							</Box>
							<Box flexGrow={1} flexShrink={1} overflow="hidden">
								<Text color="gray" wrap="truncate">
									{item.params}
								</Text>
							</Box>
						</Box>
					);
				})}
				{items.length === 0 && (
					<Box marginTop={1}>
						<Text dimColor>No matches found</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
};

async function run() {
	try {
		const initialQuery = process.argv.slice(2).join(" ");
		const history = fetchHistory();

		let selectedCommand: string | null = null;

		// Save cursor position
		process.stderr.write("\x1b[s");

		const { waitUntilExit, unmount } = render(
			<App
				history={history}
				initialQuery={initialQuery}
				onSelect={(cmd) => {
					selectedCommand = cmd;
				}}
			/>,
			{ stdout: process.stderr },
		);

		await waitUntilExit();

		// Clean up ink and restore cursor
		unmount();
		process.stderr.write("\x1b[u\x1b[J");

		if (selectedCommand) {
			process.stdout.write(selectedCommand);
		}
	} catch (e: any) {
		process.stderr.write("\x1b[u\x1b[J");
		console.error("Failed to load voyager:", e.message);
	}
}

run();
