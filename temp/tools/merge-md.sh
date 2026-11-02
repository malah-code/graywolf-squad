
#!/usr/bin/env bash
set -Eeuo pipefail

# Usage: ./merge-md.sh <input-folder> <output-path>

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <input-folder> <output-path>"
    echo "Example: $0 ./docs ./merged.md"
    exit 1
fi

INPUT="$1"
OUTPUT="$2"

if [[ ! -d "$INPUT" ]]; then
    echo "Error: input folder does not exist: $INPUT"
    exit 1
fi

ROOT="$(cd -- "$INPUT" && pwd -P)"
OUTPUT_ABS="$(realpath -m -- "$OUTPUT")"

# Ensure the output directory exists.
mkdir -p -- "$(dirname -- "$OUTPUT_ABS")"

# Collect Markdown files recursively, sorted by path.
mapfile -d '' FILES < <(
    find "$ROOT" -type f -name '*.md' -print0 |
        sort -z |
        while IFS= read -r -d '' file; do
            FILE_ABS="$(realpath -m -- "$file")"

            # Exclude the output file if it is inside the input folder.
            [[ "$FILE_ABS" == "$OUTPUT_ABS" ]] && continue

            printf '%s\0' "$file"
        done
)

if [[ ${#FILES[@]} -eq 0 ]]; then
    echo "No Markdown files found in: $ROOT"
    exit 1
fi

# Merge all files with start/end markers.
{
    printf '# Merged Markdown Files\n\n'
    printf 'Source folder: `%s`\n' "$ROOT"
    printf 'Files merged: %d\n\n' "${#FILES[@]}"
    printf '%s\n' '---'

    for file in "${FILES[@]}"; do
        RELATIVE_PATH="${file#"$ROOT"/}"

        printf '\n\n<!-- START OF FILE: %s -->\n\n' "$RELATIVE_PATH"
        printf '# Source: %s\n\n' "$RELATIVE_PATH"
        cat -- "$file"
        printf '\n\n<!-- END OF FILE: %s -->\n\n' "$RELATIVE_PATH"
        printf '%s\n' '---'
    done
} > "$OUTPUT_ABS"

echo "Merge completed successfully."
echo "Input folder: $ROOT"
echo "Files merged: ${#FILES[@]}"
echo "Output file: $OUTPUT_ABS"
