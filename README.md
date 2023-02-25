# isort-ts

Sort `ImportDeclaration` and `ImportSpecifier` based on a simple typescript transform.

## usage

```sh
npm install -D typescript prettier @hiogawa/isort-ts

# as standalone cli
npx isort-ts --fix --cache $(git grep -l . '*.ts' '*.tsx') $(git ls-files --others --exclude-standard '*.ts')

# as prettier-plugin
npx prettier --write . --plugin=@hiogawa/isort-ts
```

## development

```sh
pnpm i
pnpm dev
pnpm test
./bin/cli.js src/*.ts --fix
npx prettier --write . --plugin=./dist/index.js

# release
pnpm build
pnpm release
```
