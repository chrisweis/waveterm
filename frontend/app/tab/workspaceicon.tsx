// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, isBlank, makeIconClass } from "@/util/util";
import { memo } from "react";
import "./workspaceicon.scss";

interface WorkspaceIconProps {
    icon: string;
    color: string;
    emoji?: string;
    className?: string;
    fw?: boolean;
}

const WorkspaceIconComponent = ({ icon, color, emoji, className, fw = true }: WorkspaceIconProps) => {
    if (!isBlank(emoji)) {
        return (
            <span className={cn("workspace-emoji", className)} role="img" aria-label="workspace icon">
                {emoji}
            </span>
        );
    }
    return <i className={cn(makeIconClass(icon, fw), className)} style={{ color }} />;
};

export const WorkspaceIcon = memo(WorkspaceIconComponent);
WorkspaceIcon.displayName = "WorkspaceIcon";
