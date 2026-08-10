// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type WorkspaceSidebarEnv = WaveEnvSubset<{
    electron: {
        createWorkspace: WaveEnv["electron"]["createWorkspace"];
        switchWorkspace: WaveEnv["electron"]["switchWorkspace"];
        deleteWorkspace: WaveEnv["electron"]["deleteWorkspace"];
    };
    atoms: {
        workspace: WaveEnv["atoms"]["workspace"];
    };
    services: {
        workspace: WaveEnv["services"]["workspace"];
    };
    wos: WaveEnv["wos"];
}>;
