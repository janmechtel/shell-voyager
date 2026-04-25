export default function (pi: any) {
	pi.on("tool_call", async (event: any) => {
		if (event.toolName !== "bash") return;

		const input = event.input as { command?: string };
		if (typeof input.command !== "string") return;

		// Prevent infinite loops or double wrapping
		if (input.command.includes("__voyager_atuin_id=")) return;

		const originalCommand = input.command.trim();
		if (!originalCommand) return;

		// Append #ai to the tracked command to tag it
		const trackedCommand = `${originalCommand} #ai`;
		const trackedCommandStr = JSON.stringify(trackedCommand);

		input.command = `
__voyager_atuin_id=$(atuin history start ${trackedCommandStr})
${originalCommand}
__voyager_exit=$?
if [ -n "$__voyager_atuin_id" ]; then
  atuin history end "$__voyager_atuin_id" --exit $__voyager_exit >/dev/null 2>&1
fi
(exit $__voyager_exit)
`;
	});
}
