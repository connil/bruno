# Bruno Filestore

A generic file storage and parsing package for Bruno API client.

## Purpose

This package abstracts the file format operations for Bruno, providing a clean interface for parsing and stringifying Bruno requests, collections, folders, and environments.

## Features

- Format-agnostic APIs for file operations
- Currently supports Bruno's custom `.bru` format
- Designed for future extensibility to support YAML and other formats

## Usage

```javascript
const {
  parseRequest,
  stringifyRequest,
  parseCollection,
  stringifyCollection,
  parseEnvironment,
  stringifyEnvironment,
  parseDotEnv
} = require('@usebruno/filestore');

// Parse a .bru request file
const requestData = parseRequest(bruContent);

// Stringify request data to .bru format
const bruContent = stringifyRequest(requestData);

// Example with future format support (not yet implemented)
const requestData = parseRequest(yamlContent, { format: 'yaml' });
```

## API

The package provides the following functions:

- `parseRequest(content, options = { format: 'bru' })`: Parse request file content
- `stringifyRequest(requestObj, options = { format: 'bru' })`: Convert request object to file content
- `parseCollection(content, options = { format: 'bru' })`: Parse collection file content
- `stringifyCollection(collectionObj, options = { format: 'bru' })`: Convert collection object to file content
- `parseFolder(content, options = { format: 'bru' })`: Parse folder file content
- `stringifyFolder(folderObj, options = { format: 'bru' })`: Convert folder object to file content
- `parseEnvironment(content, options = { format: 'bru' })`: Parse environment file content
- `stringifyEnvironment(envObj, options = { format: 'bru' })`: Convert environment object to file content
- `parseDotEnv(content)`: Parse .env file content

## Bearer token prefix

Bearer authentication accepts an optional `prefix` alongside `token` at request,
folder, and collection levels. Omitting it or leaving it empty uses `Bearer`.
Both values support Bruno variables. Non-default prefixes are stored only in
`.bruno-custom.json` as `bearerTokenPrefix`, never in `.bru` or `.yml` files, so
opening and saving the collection in regular Bruno does not erase the setting.
Inline prefixes from earlier versions are read and migrated to the sidecar.
Postman exports use an Authorization API key for custom prefixes because
Postman's bearer authentication always uses `Bearer`.

## Custom request settings

Non-default bearer prefixes, query parameter encoding options and alternative path parameter values are stored in the collection's
`.bruno-custom.json` file, separate from `.bru` and `.yml` requests.
Commit this file alongside the collection to share those options. Entries are
keyed by collection-relative request path (without the file extension) and
parameter name and occurrence for query encoding. Each request entry may contain
`queryParamEncoding` and `pathParams` arrays, and a `bearerTokenPrefix` string.
Collection auth uses the key `/`; folder auth uses its relative directory with
a trailing `/` (for example `API/`). These keys are stable across format changes.
Only non-default settings get an entry. An empty prefix or `Bearer` is not stored.
Request files contain one selected value per path parameter name;
other values, descriptions and selection state remain in the sidecar. Edits to
the selected value in standard Bruno are picked up without losing alternatives.
The old `.bruno-query-encoding.json` file is still read and migrated to the new
name when opened in the desktop app or when settings are saved.
Renaming a parameter or reordering query parameters
with the same name outside Bruno may require updating its settings. Moving or
renaming request files outside this version also requires updating their paths
in the sidecar.
