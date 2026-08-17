import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "../element/button";
import { Input } from "../element/input";
import { WorkspaceService } from "../store/services";
import "./workspaceeditor.scss";

interface ColorSelectorProps {
    colors: string[];
    selectedColor?: string;
    onSelect: (color: string) => void;
    className?: string;
}

const ColorSelector = memo(({ colors, selectedColor, onSelect, className }: ColorSelectorProps) => {
    const handleColorClick = (color: string) => {
        onSelect(color);
    };

    return (
        <div className={clsx("color-selector", className)}>
            {colors.map((color) => (
                <div
                    key={color}
                    className={clsx("color-circle", { selected: selectedColor === color })}
                    style={{ backgroundColor: color }}
                    onClick={() => handleColorClick(color)}
                />
            ))}
        </div>
    );
});

interface IconSelectorProps {
    icons: string[];
    selectedIcon?: string;
    onSelect: (icon: string) => void;
    className?: string;
}

const IconSelector = memo(({ icons, selectedIcon, onSelect, className }: IconSelectorProps) => {
    const handleIconClick = (icon: string) => {
        onSelect(icon);
    };

    return (
        <div className={clsx("icon-selector", className)}>
            {icons.map((icon) => {
                const iconClass = makeIconClass(icon, true);
                return (
                    <i
                        key={icon}
                        className={clsx(iconClass, "icon-item", { selected: selectedIcon === icon })}
                        onClick={() => handleIconClick(icon)}
                    />
                );
            })}
        </div>
    );
});

// Emoji are frequently multi-codepoint (ZWJ sequences, skin-tone modifiers), so trim by grapheme
// rather than by character -- slicing a family emoji by code unit yields garbage.
function firstGrapheme(str: string): string {
    if (isBlank(str)) {
        return "";
    }
    const seg = new (Intl as any).Segmenter(undefined, { granularity: "grapheme" });
    const first = Array.from(seg.segment(str))[0] as { segment: string };
    return first?.segment ?? "";
}

interface EmojiSelectorProps {
    emoji: string;
    onSelect: (emoji: string) => void;
}

const EmojiSelector = memo(({ emoji, onSelect }: EmojiSelectorProps) => {
    return (
        <div className="emoji-selector">
            <Input
                className="emoji-input"
                value={emoji ?? ""}
                placeholder="🙂"
                onChange={(val) => onSelect(firstGrapheme(val))}
            />
            <div className="emoji-hint">
                {isBlank(emoji) ? (
                    <span>Paste an emoji, or press Win + . / Ctrl + Cmd + Space</span>
                ) : (
                    <Button className="ghost text-[12px]" onClick={() => onSelect("")}>
                        Use icon instead
                    </Button>
                )}
            </div>
        </div>
    );
});
EmojiSelector.displayName = "EmojiSelector";

interface WorkspaceEditorProps {
    title: string;
    icon: string;
    color: string;
    emoji: string;
    focusInput: boolean;
    onTitleChange: (newTitle: string) => void;
    onColorChange: (newColor: string) => void;
    onIconChange: (newIcon: string) => void;
    onEmojiChange: (newEmoji: string) => void;
    onDeleteWorkspace: () => void;
}
const WorkspaceEditorComponent = ({
    title,
    icon,
    color,
    emoji,
    focusInput,
    onTitleChange,
    onColorChange,
    onIconChange,
    onEmojiChange,
    onDeleteWorkspace,
}: WorkspaceEditorProps) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const [colors, setColors] = useState<string[]>([]);
    const [icons, setIcons] = useState<string[]>([]);

    useEffect(() => {
        fireAndForget(async () => {
            const colors = await WorkspaceService.GetColors();
            const icons = await WorkspaceService.GetIcons();
            setColors(colors);
            setIcons(icons);
        });
    }, []);

    useEffect(() => {
        if (focusInput && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [focusInput]);

    return (
        <div className="workspace-editor">
            <Input
                ref={inputRef}
                className={clsx("py-[3px]", { error: title === "" })}
                onChange={onTitleChange}
                value={title}
                autoFocus
                autoSelect
            />
            <ColorSelector selectedColor={color} colors={colors} onSelect={onColorChange} />
            {/* Picking an icon also clears the emoji. An emoji overrides the icon everywhere, so
                without this the grid is dead UI while one is set: nothing reads as selected, and
                clicking changes the stored icon with no visible effect. */}
            <IconSelector
                selectedIcon={isBlank(emoji) ? icon : null}
                icons={icons}
                onSelect={(newIcon) => {
                    onIconChange(newIcon);
                    if (!isBlank(emoji)) {
                        onEmojiChange("");
                    }
                }}
            />
            <EmojiSelector emoji={emoji} onSelect={onEmojiChange} />
            <div className="delete-ws-btn-wrapper">
                <Button className="ghost red text-[12px] bold" onClick={onDeleteWorkspace}>
                    Delete workspace
                </Button>
            </div>
        </div>
    );
};

export const WorkspaceEditor = memo(WorkspaceEditorComponent) as typeof WorkspaceEditorComponent;
