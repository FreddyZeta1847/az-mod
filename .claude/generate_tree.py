"""
generate_tree.py — prints the project's file tree for tree.md.

Only files git would publish are listed (tracked + untracked-not-ignored, via
`git ls-files -co --exclude-standard`), so ignored private folders such as
blueprint/ and design/ never appear in the public tree.md.

Usage (from the repository root, Windows):
    $env:PYTHONIOENCODING = "utf-8"; python .claude\\generate_tree.py | Out-File -Encoding utf8 tree.md
"""
import subprocess


def git_files():
    out = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard"],
        capture_output=True, text=True, check=True, encoding="utf-8",
    ).stdout
    return sorted(p for p in out.splitlines() if p)


def build(paths):
    root = {}
    for path in paths:
        node = root
        for part in path.split("/"):
            node = node.setdefault(part, {})
    return root


def render(node, prefix=""):
    entries = sorted(node.items(), key=lambda kv: (not kv[1], kv[0]))
    for i, (name, child) in enumerate(entries):
        last = i == len(entries) - 1
        print(prefix + ("└── " if last else "├── ") + name + ("/" if child else ""))
        if child:
            render(child, prefix + ("    " if last else "│   "))


if __name__ == "__main__":
    print(".")
    render(build(git_files()))
