string-resolver
===============

A tool to read through a NetlifyCMS-managed mobile app content directory
(really just a pile of JSON entries in a particular format)
and assemble strings files for a particular client application.


Sample Configuration
====================

Configuration can be a JSON file or a JS file, it will be passed to require(),
so export your config or config function as default.

```json
{
  "output": {
    "code": "some/directory/MyStringClass.swift", // Used for code gen
    "strings": "some/directory",   // Used for strings file gen
  },
  "cultures": ["en", "en-AU"],  // What cultures does your app support? The first one is considered the "base" culture which will influence the others (e.g. defaults)
  "content": {
    "repo": "gas-buddy/gasbuddy-content",   // If you want to get info from a repo
    "branch": "master", // Which branch to pull from (you can use JS remember... process.env.STRING_BRANCH || 'master') is a good idea
    "path": "app/content",   // If using GIT - the path in the repo. If not, the local path
  }
}
```