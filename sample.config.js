module.exports = {
  output: {
    code: 'LocalStrs/MyStringClass.swift', // Used for code gen
    strings: 'LocalStrs', // Used for strings file gen
  },
  cultures: ['en', 'en-AU'], // What cultures does your app support? The first one is considered the "base" culture which will influence the others (e.g. defaults)
  content: {
    repo: 'gas-buddy/gasbuddy-content', // If you want to get info from a repo
    branch: process.env.STRINGS_BRANCH || 'master', // Which branch to pull from (you can use JS remember... process.env.STRING_BRANCH || 'master') is a good idea
    path: 'app/content', // If using GIT - the path in the repo. If not, the local path
  },
};
