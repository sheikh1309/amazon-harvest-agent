export const ExitCode = {
    Ok: 0,
    Failed: 1,
    Misconfigured: 2,
    QueueEmpty: 3,
    Interrupted: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
