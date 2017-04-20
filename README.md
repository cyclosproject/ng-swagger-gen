nd-swagger-gen: A Swagger 2.0 codegen for Angular 2+
---

This project is a NPM module that takes a [Swagger 2.0](http://swagger.io/)
JSON [specification](http://swagger.io/specification/) and generates services
and model classes for an Angular 2+ project.

This generator may not cover all usages of the Swagger 2.0 specifications.

The design principles are:

- It must be easy to use;
- It should provide access to the original response, so, for example, headers
  can be read. But also it should provide easy access to the result;
- It should generate code which follows the concepts of an Angular 2+
  application, such as Modules, Injectables, etc;
- The generated model should handle correctly inheritance and enumerations;
- An Angular Module (@NgModule) is generated, which exports all services;
- One service is generated per Swagger tag;
- It should be possible to choose a subset of tags from which to generate
  services;
- It should generate only the models actually used by the generated service;
- The configuration of the root URL for the API, as well as an error handler
  and authentication setup of the request (header with API token, basic auth,
  etc) are handled in a generated class called `ApiConfiguration`.

Here are a few notes:

- The descriptor must be in JSON format. If you have your Swagger file in
  YAML format, use the [online swagger editor](http://editor.swagger.io) to
  export the descriptor as JSON;
- Each operation MUST have ONE AND ONLY ONE Swagger tag. By design, each tag
  generates a service class;
- File uploads are not supported;
- Each service returns `Promise`s. Direct access to `Observable`s is not
  implemented.
- Probably many more.

## How to use it:
In your project, run:
```bash
cd <your_angular2+_app_dir>
npm install ng-swagger-gen --save
node_modules/.bin/ng-swagger-gen <path_to_swagger_json> [output_dir]
```
Where:

- `path_to_swagger` is either a relative path to the Swagger JSON file or an
  URL.
- `output_dir` is the directory where the generated code will be outputted. It
  is recommended that this directory is ignored on GIT (or whatever source
  control software you are using), for example, by adding its name to
  `.gitignore`. The default output directory if nothing is specified is
  `src/app/api`.

The folder `src/app/api` (or your custom folder) will contain the following
structure:

```
project_root
+- src
   +- app
      +- api
         +- models
         |  +- model1.ts
         |  +- ...
         |  +- modeln.ts
         +- services
         |  +- tag1.service.ts
         |  +- ...
         |  +- tagn.service.ts
         +- api-configuration.ts
         +- api-response.ts
         +- api.module.ts
         +- models.ts
         +- services.ts
```

The files are:

- **api/models/model*n*.ts**: One file per model file is generated here.
  Enumerations are also correctly generated;
- **api/models.ts**: An index script which exports all model classes. It is
  used to make it easier for application classes to import models, so they can
  use `import { Model1, Model2 } from 'api/models'` instead of 
  `import { Model1 } from 'api/models/model1'` and
  `import { Model2 } from 'api/models/model2'`;
- **api/services/tag*n*.service.ts**: One file per Swagger tag is generated
  here;
- **api/services.ts**: An index script which exports all service classes,
  similar to the analog file for models;
- **api/api-configuration.ts**: A configuration class that holds the following
  public static properties, which can be set directly in your `AppModule` (or
  some other imported module):
  - *rootUrl*: A string pointing to the root URL for the API. The default value
    is read from the Swagger description, from the `schemes`, `host` and
    `basePath` definitions;
  - *handleError*: A function that takes the error as input, and works as a
    general error handler for any error returned by the API. A global error
    handler can be disabled in the configuration file. In that case, this
    property is not generated;
  - *prepareRequestOptions*: A function that takes a `RequestOptions` object
    before any actual request. It can be used, for example, to set authorization
    headers, additional search parameters, etc.
- **api/api-response.ts**: A wrapper class that holds both the original response
  object, which has a type variable: `ApiResponse<T>`, where `T` is the type of
  the first operation response in the 2xx range. The following properties are
  available:
  - *response*: The original HTTP response;
  - *data*: The data returned by the operation, according to the operation
    successful response.
- **api/api.module.ts**: A module that declares an `NgModule` that provides all
  services. If this module is imported by your `AppModule` (or some other
  shared / core module) automatically all services are provided for dependency
  injection in your component constructors.

## Using a configuration file
If you place a file called `ng-swagger-gen.json` in the root folder of your
project, or in the current directory if `ng-swagger-gen` is installed globally,
the script parameters can be omitted. It is recommended to use a configuration
file, because it grants greater control over the generation.

If you have installed and saved the `ng-swagger-gen` module in your node
project, you can use a JSON schema in your configuration file pointing to
`./node_modules/ng-swagger-gen/ng-swagger-gen-schema.json`.
It is also possible to use the online version at 
`https://github.com/cyclosproject/ng-swagger-gen/blob/master/ng-swagger-gen-schema.json`.

The supported properties in the JSON file are:

- `swagger`: The location of the swagger descriptor in JSON format.
  May be either a local file or URL.
- `output`: Where generated files will be written to. Defaults to `src/app/api`.
- `includeTags`: When specified, filters the generated services to be only
  those corresponding to this list of tags.
- `ignoreUnusedModels`: Indicates whether or not to ignore model files that are
  not referenced by any operation. Defaults to true.
- `removeStaleFiles`: Indicates whether or not to remove any files in the
  output folder that were not generated by ng-swagger-gen. Defaults to true.
- `modelIndex`: Indicates whether or not to generate the file which exports all
  models. Defaults to true.
- `errorHandler`: Indicates whether or not to generate all service calls with a
  global error handler. Defaults to true.
- `serviceIndex`: Indicates whether or not to generate the file which exports
  all services. Defaults to true.
- `apiModule`: Indicates whether or not to generate the Angular module which
  provides all services. Defaults to true.
- `templates`: Path to override the Mustache templates used to generate files.

The following is an example of a configuration file which will choose a few
tags to generate, and chose not to generate the ApiModule class:
```json
{
  "$schema": "./node_modules/ng-swagger-gen/ng-swagger-gen-schema.json",
  "swagger": "my-swagger.json", 
  "includeTags": [
    "Blogs",
    "Comments",
    "Users"
  ],
  "apiModule": false
}
```

This will not only generate only the services for the chosen tags, but models
which are not referenced by any of the generated services are skipped,
preventing the generation of unused classes.

## Setting up a node script
Regardless If your Angular project was generated or is managed by
[Angular CLI](https://cli.angular.io/), or you have started your project with
some other seed (for example, using [webpack](https://webpack.js.org/)
directly), you can setup a script to make sure the generated API classes are
consistent with the swagger descriptor.

To do so, create the `ng-swagger-gen.json` configuration file and add the
following in your `package.json`:
```json
{
  ...
  "scripts": {
    "ng": "ng",
    "start": "ng-swagger-gen && ng serve",
    "build": "ng-swagger-gen && ng build -prod",
    "lint": "ng lint"
  },
  ...
}
```
This way whenever you run `npm run start` or `npm run build`, the API classes
will be generated before actually serving / building your application.

## Swagger extensions
The swagger specification doesn't allow referencing an enumeration to be used
as an operation parameter. Hence, `ng-swagger-gen` supports the vendor
extension `x-type` in operations, whose value could either be a model name
representing an enum or `Array<EnumName>` or `List<EnumName>` (both are
equivallents) to use an array of models.

## Who uses this project
This project was developed by the [Cyclos](http://cyclos.org) development team,
and, in fact, the [Cyclos REST API](https://demo.cyclos.org/api) is the primary
test case for generated classes.

That doesn't mean that the generator works only for the Cyclos API. For
instance, the following commands will generate an API client for
[Swagger's PetStore](http://petstore.swagger.io) example, assuming
[Angular CLI](https://cli.angular.io/) is installed:
```bash
ng new petstore
cd petstore
npm install ng-swagger-gen --save
node_modules/.bin/ng-swagger-gen http://petstore.swagger.io/v2/swagger.json
```
