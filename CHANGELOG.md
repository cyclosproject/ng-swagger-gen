# Changelog
This is the version history for `ng-swagger-gen`

### 0.4.2 (2017-05-05)
- New fix for https://github.com/cyclosproject/ng-swagger-gen/issues/2

### 0.4.1 (2017-05-05)
- Fixed https://github.com/cyclosproject/ng-swagger-gen/issues/2

### 0.4.0 (2017-05-02)
- Allow customizing the minimum number of parameters to generate a wrapper class
- Don't send empty header / query parameters for null array elements
- Minor cosmetic changes

### 0.3.2 (2017-04-26)
- Don't send empty header / query parameters for null arguments
- Fixed generation for number and boolean result types

### 0.3.1 (2017-04-21)
- Fixed handling of arrays using x-type vendor extensions (thanks to @giacomozr)

### 0.3.0 (2017-04-19)
- Made all services return the ApiResponse, which contains both the 
  response and result data
- Bug fixes

### 0.2.1 (2017-04-05)
- Bug fixes

### 0.2.0 (2017-04-04)
- Added support for a configuration file
- Added the possibility to choose which tags to include in the generation
- Allow control over more aspects of the generation
- Bug fixes

### 0.1.1 (2017-03-30)
- Minor fixes

### 0.1.0 (2017-03-29)
- Initial release