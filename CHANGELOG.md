# Changelog
This is the version history for `ng-swagger-gen`

### 0.6.0 (2017-06-02)
- Allow generating the configuration file.
  https://github.com/cyclosproject/ng-swagger-gen/issues/8
- Improved the command-line argument parsing. This breaks previous positional
  arguments, which are no longer supported. Now the input Swagger JSON should be
  passed in with the -i argument, and the output folder, with the -o argument.
  https://github.com/cyclosproject/ng-swagger-gen/issues/9

### 0.5.3 (2017-06-02)
- Removed an unwanted debug log.

### 0.5.2 (2017-06-02)
- Added support for parameters with [] in name.
  https://github.com/cyclosproject/ng-swagger-gen/issues/7

### 0.5.1 (2017-05-30)
- Added support for models as objects without explicit "type": "object".
  https://github.com/cyclosproject/ng-swagger-gen/issues/4
- Error generating operations without any parameters.
  https://github.com/cyclosproject/ng-swagger-gen/issues/5
- Added support for models of "type": "array".
  https://github.com/cyclosproject/ng-swagger-gen/issues/6

### 0.5.0 (2017-05-16)
- Changed the default value for `minParamsForContainer` to 2. This way,
  operations that take a single argument won't have a parameter class.
  If the old behavior is desired, just set `minParamsForContainer` to 1 in
  `ng-swagger-gen.json`.
- Made generation more robust regarding in several ways:
  - If an operation doesn't define an id, one is generated 
    (using the HTTP method + path)
  - If an operation has no tag, a default tag is assumed 
    (configurable, defaults to 'Api')
  - If an operation defines multiple tags, only the first one is used
  - If a model is named `ApiResponse` the generation won't conflict with the
    generated `ApiResponse`.
- Don't fail if an operation has single / multiple tags, or no id.
  https://github.com/cyclosproject/ng-swagger-gen/issues/3

### 0.4.2 (2017-05-05)
- New fix for https://github.com/cyclosproject/ng-swagger-gen/issues/2

### 0.4.1 (2017-05-05)
- Fixed generation of operations returning arrays of primitive types.
  https://github.com/cyclosproject/ng-swagger-gen/issues/2

### 0.4.0 (2017-05-02)
- Allow customizing the minimum number of parameters to generate a wrapper class.
- Don't send empty header / query parameters for null array elements.
- Minor cosmetic changes.

### 0.3.2 (2017-04-26)
- Don't send empty header / query parameters for null arguments.
- Fixed generation for number and boolean result types.

### 0.3.1 (2017-04-21)
- Fixed handling of arrays using x-type vendor extensions (thanks to @giacomozr).

### 0.3.0 (2017-04-19)
- Made all services return the ApiResponse, which contains both the
  response and result data.
- Bug fixes.

### 0.2.1 (2017-04-05)
- Bug fixes.

### 0.2.0 (2017-04-04)
- Added support for a configuration file.
- Added the possibility to choose which tags to include in the generation.
- Allow control over more aspects of the generation.
- Bug fixes.

### 0.1.1 (2017-03-30)
- Minor fixes.

### 0.1.0 (2017-03-29)
- Initial release.