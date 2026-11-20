= Release

This document presents the release process, just to not forget.

== Checklist

- [ ] Update `README.md` with plugin version
- [ ] Update `CHANGELOG.md`
- [ ] Update version in `package.json`
- [ ] Update version in `vscode-plugin/pom.xml` (parent `<version>`) and in the `<parent><version>` of `vscode-plugin/core/pom.xml`, `vscode-plugin/iiq8/pom.xml` and `vscode-plugin/iiq9/pom.xml`  (or `cd vscode-plugin && mvn versions:set -DnewVersion=x.y.z`)
- [ ] Update Discuss page: https://developer.sailpoint.com/discuss/t/identityiq-extension-for-visual-studio-code-cursor/223749

== Publish in the marketplace and GitHub Release

When a tag with the format "releases/*v0.0.3*" is created:
- The VSIX package is automatically created
- The package is published in the marketplace
- A release is created


To create the tag:

```
git tag releases/v1.0.3
git push origin --tags
```

== Remove a tag locally and remotely

```
git tag -d releases/v0.0.3
git push --delete origin releases/v0.0.3
```

== Other

Compare a tag and HEAD:

https://github.com/yannick-beot-sp/vscode-sailpoint-identityiq/compare/releases%2Fv0.0.25..HEAD