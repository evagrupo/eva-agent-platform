Monitor and safely manage the machine that runs the BB server from a sidebar page. See live CPU, memory, storage, and uptime, browse files, find reclaimable space, and inspect the processes and open ports on the machine.

## What you get

- Live CPU, RAM, storage, uptime, and host information.
- A file browser with path navigation and labels for protected locations.
- Move, quarantine, and explicitly confirmed permanent-delete actions.
- A cleanup scanner that totals folders and surfaces caches, browser data, developer artifacts, temporary files, logs, and large files.
- A process viewer with search plus graceful stop and force-kill actions.
- An open-port viewer showing TCP listeners and UDP endpoints with their owning process.

## Safety

System files, PID 1, and BB's own server processes are protected. Process actions require confirmation, cleanup is review-first, and quarantine is preferred over permanent deletion. Port actions also protect privileged ports, common system services, BB-managed processes, and endpoints whose owner cannot be verified.

Because the plugin can delete files and stop processes on the server, it is off by default. Enable it only for administrators who need it.
