# Test fixtures

`fixture.jar` contains the compiled classes of `java-src/` and backs the unit
tests of the BeanShell class index (`src/test/beanshell/`). It is committed so
the tests do not require a JDK.

Regenerate it after changing the Java sources (requires JDK 11+):

```bash
npm run build-test-fixtures
```

The classes are compiled with `-g` on purpose: the tests verify that method
parameter names are recovered from the `LocalVariableTable`.
