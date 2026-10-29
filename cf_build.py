#!/usr/bin/env python3
"""Cloudflare Pages build for birdiebuddy.io.

Build command: python3 cf_build.py      Output directory: dist

Copies the git-tracked tree (os.walk fallback when git is unavailable) into dist/,
leaving out repo tooling, internal notes/backups and files that are not meant to be
served. Standard library only, Python 3.8+. GitHub Pages ignores this file.
"""
import fnmatch
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'dist')

# Top-level directories that never ship.
EXCLUDE_DIRS = ('.git/', '.github/', 'scripts/', 'functions/', 'gha_scripts/', 'dist/')
# Basename globs.
EXCLUDE_GLOBS = ('*.md', '*.py', '*.sh', '*.bak', '*.bak_*', '*.test', 'test_*')
# Basename substrings (pre-fix snapshots, test scratch).
EXCLUDE_SUBSTR = ('.pre_', 'pre_night', '.test_')
# Exact basenames (repo / GitHub Pages plumbing).
EXCLUDE_NAMES = ('CNAME', '.nojekyll', '.gitignore', '.DS_Store')
# Internal pipeline files that are public today but referenced by no page.
# (data/shadow_models.json stays: every golf header reads it.)
EXCLUDE_PATHS = (
    'MANUAL_OVERRIDES.json',
    'mnemosyne_status.json',
    'CALIBRATION_TRACKER.json',
    'SPEARMAN_TRACKER.json',
    'CURRENT_EVENT.json',
    'data/mnemosyne_status.json',
    'data/nike_bankroll.json',
)


def excluded(rel):
    """Return the reason a repo-relative path is left out, or None to copy it."""
    rel = rel.replace(os.sep, '/')
    name = rel.rsplit('/', 1)[-1]
    for d in EXCLUDE_DIRS:
        if rel.startswith(d):
            return 'dir ' + d
    if rel in EXCLUDE_PATHS:
        return 'internal'
    if name in EXCLUDE_NAMES:
        return 'name'
    for g in EXCLUDE_GLOBS:
        if fnmatch.fnmatchcase(name, g):
            return 'glob ' + g
    for s in EXCLUDE_SUBSTR:
        if s in name:
            return 'contains ' + s
    return None


def tracked_files():
    try:
        out = subprocess.run(['git', '-C', ROOT, 'ls-files', '-z'], stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, check=True).stdout
        files = [f for f in out.decode('utf-8').split('\0') if f]
        if files:
            return files, 'git ls-files'
    except (OSError, subprocess.CalledProcessError):
        pass
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        rel_dir = '' if rel_dir == '.' else rel_dir.replace(os.sep, '/') + '/'
        dirnames[:] = [d for d in dirnames if not excluded(rel_dir + d + '/')]
        files.extend(rel_dir + f for f in filenames)
    return files, 'os.walk'


def main():
    files, source = tracked_files()
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    copied, skipped = 0, []
    for rel in sorted(files):
        why = excluded(rel)
        if why:
            skipped.append((rel, why))
            continue
        src = os.path.join(ROOT, rel)
        if not os.path.isfile(src):          # tracked but deleted in the working tree
            skipped.append((rel, 'missing'))
            continue
        dst = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    print('cf_build: %d files from %s -> dist/ (%d copied, %d excluded)'
          % (len(files), source, copied, len(skipped)))
    for rel, why in skipped:
        print('  excluded  %-55s %s' % (rel, why))
    if not os.path.isfile(os.path.join(OUT, 'index.html')):
        sys.exit('cf_build: dist/index.html missing, refusing to ship an empty site')


if __name__ == '__main__':
    main()
