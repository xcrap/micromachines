export interface MenuOption {
    label: string;
    onSelect(): void;
}

interface PauseMenuProps {
    options: readonly MenuOption[];
    focused: number;
    onFocus(index: number): void;
}

export function PauseMenu({ options, focused, onFocus }: PauseMenuProps) {
    return (
        <div className="pointer-events-auto absolute inset-0 flex items-center bg-ink/45 font-body">
            <div className="ml-[clamp(16px,8vw,120px)] flex flex-col items-start">
                <h2 className="animate-slap outlined-type text-[clamp(56px,8vw,104px)] leading-none text-toy-yellow">PAUSED</h2>
                <div className="mt-6 flex flex-col gap-3">
                    {options.map((option, index) => (
                        <button
                            key={option.label}
                            type="button"
                            onClick={option.onSelect}
                            onMouseEnter={() => onFocus(index)}
                            className={`animate-rise sticker cursor-pointer px-5 py-2 text-left font-display text-[clamp(20px,2.4vw,28px)] transition-transform duration-200 ease-out-quint ${index === focused ? "translate-x-3 -rotate-1 bg-toy-yellow" : ""}`}
                            style={{ animationDelay: `${60 + index * 50}ms` }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
                <p className="mt-5 text-[13px] font-bold text-paper [text-shadow:0_2px_0_var(--color-ink)]">
                    <span className="keycap">Esc</span> to resume
                </p>
            </div>
        </div>
    );
}
