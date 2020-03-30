ng-swagger-gen: A Swagger 2.0 code generator for Angular
---

This project is a NPM module that generates model interfaces and web service
clients from a [Swagger 2.0](http://swagger.io/)
[specification](http://swagger.io/specification/).
The generated classes follow the principles of
[Angular](https://angular.io/).

Angular / RxJS version compatibility:

- Starting with version `2.0.0`, Angular 7+ is required.
- Starting with version `1.0.0`, Angular 6+ is required.
- Version `0.11.x` supports Angular 4.3+ (with rxjs 5.5) and Angular 5.

## OpenAPI 3

If you are interested in generating a client for services described using
OpenAPI 3, take a look on
[ng-openapi-gen](https://github.com/cyclosproject/ng-openapi-gen).

## Major version upgrade notices

- [Angular 6](https://blog.angular.io/version-6-of-angular-now-available-cc56b0efa7a4)
  bundles RxJS 6, which
  [changed the API, mostly imports](https://github.com/ReactiveX/rxjs/blob/master/MIGRATION.md).
  As such, starting with `ng-swagger-gen` version `1.0.0`, both peer
  dependencies for `@angular/core` and `rxjs` have been upgraded. If you plan to
  stay in Angular 5, change the `ng-swagger-gen` version in `package.json` to
  `~0.11.0`;
- Up to the version `0.8.x` of this generator the deprecated `Http` Angular
  module was used to generating requests. Starting with version 0.9,
  `HttpClient` is used instead - hence the requirement for Angular 4.3+.
  Also, taking the opportunity to break backwards compatibility,
  some additional changes were also performed, such as returning `Observable`s
  instead of `Promise`s. For more details, please see the wiki page
  [Upgrading from previous versions to 0.9](https://github.com/cyclosproject/ng-swagger-gen/wiki/Upgrading-from-previous-versions-to-0.9).

## Design principles

- It must be easy to use;
- It should provide access to the original response, so, for example, headers
  can be read. But also it should provide easy access to the result;
- It should generate code which follows the concepts of an Angular 4+
  application, such as Modules, Injectables, etc;
- All the server communication is implemented using `HttpClient`;
- The generated model should handle correctly inheritance and enumerations.
  Starting from version `0.10` all modules are generated as TypeScript
  interfaces rather than classes, avoiding additional overhead on generated
  JavaScript;
- An Angular Module (`@NgModule`) is generated, which exports all services;
- One service is generated per Swagger tag;
- It should be possible to choose a subset of tags from which to generate
  services;
- It should generate only the models actually used by the generated services;
- The configuration of the root URL for the API is set globally in an
  `@Injectable` class called `ApiConfiguration`, but can also be set on each
  service, for increased flexibility.

Here are a few notes:

- Starting with version 0.11.0, the Swagger definition can be either a JSON or
  YAML file (thanks to @jfyne);
- Starting with version 0.11.0, file downloads / uploads are supported using
  the native [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) type;
- Each operation is assumed to have a single tag. If none is declared, a default
  of `Api` (configurable) is assumed. If multiple tags are declared, the first
  one is used;
- Each tag generates a service class;
- Operations that don't declare an id have an id generated. However, it is
  recommended that all operations define an id;
- Two methods are generated for each service operation: one returning
  `Observable<HttpResponse<T>>` (the method is suffixed with `Response`) and
  another one returning `Observable<T>`;
- This generator may not cover all corner cases of the Swagger 2.0
  specification;
- OpenAPI 3.0 is not supported, but may be added in the future;
- Probably many more.

## Requirements
The generator itself has very few requirements, basically
[json-schema-ref-parser](https://www.npmjs.com/package/json-schema-ref-parser),
[argparse](https://www.npmjs.com/package/argparse) and
[mustache](https://www.npmjs.com/package/mustache).

However, starting with the version 1.0.0, the generated code requires
both Angular 6.0+ and RxJS 6.0+. These versions are expressed as
`peerDependencies`, so make sure you don't have unmet peer dependencies.
If you are stuck on previous versions of Angular / RxJS, you can use
`ng-swagger-gen` version as `~0.11.0`, which supports Angular 4.3, and RxJS 5.5.

## How to use it
In your project, run:
```bash
cd <your_angular_app_dir>
npm install ng-swagger-gen --save-dev
node_modules/.bin/ng-swagger-gen -i <path_to_swagger_json> [-o output_dir]
```
Where:

- `path_to_swagger_json` is either a relative path to the Swagger JSON
  file or an URL.
- `output_dir` is the directory where the generated code will be outputted. It
  is recommended that this directory is ignored on GIT (or whatever source
  control software you are using), for example, by adding its name to
  `.gitignore`. The default output directory if nothing is specified is
  `src/app/api`.

Please, run the `ng-swagger-gen` with the `--help` argument to view all
available command line arguments.

### Generated folder structure
The folder `src/app/api` (or your custom folder) will contain the following
structure:

```
project_root
+- src
   +- app
      +- api
         +- models
         |  +- model1.ts
         |  +- model1.example.json
         |  +- ...
         |  +- modeln.ts
         |  +- modeln.example.json
         +- services
         |  +- tag1.service.ts
         |  +- ...
         |  +- tagn.service.ts
         +- api.module.ts
         +- api-configuration.ts
         +- base-service.ts
         +- models.ts
         +- services.ts
```

The files are:

- **api/models/model*n*.ts**: One file per model file is generated here.
  Enumerations are also correctly generated;
- **api/models/model*n*.ts**: One file per example is generated for each model that has `example` section.
- **api/models.ts**: An index script which exports all model interfaces. It is
  used to make it easier for application classes to import models, so they can
  use `import { Model1, Model2 } from 'api/models'` instead of
  `import { Model1 } from 'api/models/model1'` and
  `import { Model2 } from 'api/models/model2'`;
- **api/services/tag*n*.service.ts**: One file per Swagger tag is generated
  here;
- **api/services.ts**: An index script which exports all service classes,
  similar to the analog file for models;
- **api/api-configuration.ts**: An `@Injectable` class that holds global
  configuration. Currently the only global configuration option is `rootUrl`,
  which defaults to the URL in the source Swagger definition, and can be
  overridden in your application before doing the first API call;
- **api/base-service.ts**: Base class which all generated services extend. It
  provides the ability to override the root URL used by a particular service.
  If the service root URL is `null`, which is the default, the service will use
  the global root URL defined in `ApiConfiguration`;
- **api/api.module.ts**: A module that declares an `NgModule` that provides all
  services, plus the `ApiConfiguration` instance. Your root application module
  should import this module to ensure all services are available via dependency
  injection on your application.

## Using a configuration file
On regular usage it is recommended to use a configuration file instead of
passing command-line arguments to `ng-swagger-gen`. The default configuration
file name is `ng-swagger-gen.json`, and should be placed on the root folder
of your NodeJS project. Besides allowing to omit the command-line arguments,
using a the configuration file allows a greater degree of control over the
generation.

An accompanying JSON schema is also available, so the configuration file can be
validated, and IDEs can autocomplete the file. If you have installed and
saved the `ng-swagger-gen` module in your node project, you can use a local copy
of the JSON schema on `./node_modules/ng-swagger-gen/ng-swagger-gen-schema.json`.
It is also possible to use the online version at
`https://github.com/cyclosproject/ng-swagger-gen/blob/master/ng-swagger-gen-schema.json`.

It is also possible to specify the configuration file to use. This is useful
when multiple APIs are generated. To specify a configuration file, use the
argument `--config` or its short form, `-c`, like this:

```bash
ng-swagger-gen --config custom-config.json
```

When working with multiple APIs, it is advised to set a different prefix for
each one. This impacts the generated global files, such as `ApiModule` and
`ApiConfiguration`. The default prefix is `Api`, leading to those names.
But, if the specified `prefix` in the configuration file is, for example,
`Customers`, the generated files will be `CustomersModule`
and `CustomersConfiguration`. The prefix support has been added in version 1.3.

### Generating the configuration file
To generate a configuration file, run the following in the root folder of
your project;

```bash
ng-swagger-gen --gen-config [-i path_to_swagger_json] [-o output_dir]
```

This will generate the `ng-swagger-gen.json` file in the current directory
with the property defaults, plus the input Swagger JSON path (or URL) and
the output directory that were specified together. Both are optional, and the
file is generated anyway.

### Configuration file reference
The supported properties in the JSON file are:

- `swagger`: The location of the swagger descriptor in JSON format.
  May be either a local file or URL.
- `output`: Where generated files will be written to. Defaults to `src/app/api`.
- `prefix`: A prefix to the generated global classes, such as `Configuration`
  and `Module`. Defaults to 'Api', so the default generated files are
  `ApiConfiguration` and `ApiModule`.
- `includeTags`: When specified, filters the generated services, including only
  those corresponding to this list of tags.
- `excludeTags`: When specified, filters the generated services, excluding any
  service corresponding to this list of tags.
- `ignoreUnusedModels`: Indicates whether or not to ignore model files that are
  not referenced by any operation. Defaults to true.
- `minParamsForContainer`: Indicates the minimum number of parameters to wrap
  operation parameters in a container class. Defaults to 2.
- `sortParams`: How to sort operation parameters. Required always come first.
  For backwards compatibility, the default value is `desc`, but `none` is
  recommended for new projects.
- `defaultTag`: The assumed tag for operations that don't define any.
  Defaults to `Api`.
- `removeStaleFiles`: Indicates whether or not to remove any files in the
  output folder that were not generated by ng-swagger-gen. Defaults to true.
- `modelIndex`: Indicates whether or not to generate the file which exports all
  models. Defaults to true.
- `serviceIndex`: Indicates whether or not to generate the file which exports
  all services. Defaults to true.
- `apiModule`: Indicates whether or not to generate the Angular module which
  provides all services and the `ApiConfiguration`. Defaults to true.
- `enumModule`: Indicates whether or not to export an additional TypeScript
  module (not to be confused with Angular's @NgModule) for each enum model,
  exporting values as constants and providing the values() method. Setting to
  false will reduce the size of the generated code. Defaults to true.
- `templates`: Path to override the Mustache templates used to generate files.
- `generateExamples`: When set to true, for models that provide an
  [example](https://swagger.io/docs/specification/2-0/adding-examples/)
  section, will generate a corresponding `<model>.example.ts` file, exporting a
  function called `get<Model>Example()`, which will return the data present in
  the example section.
- `camelCase`: Generates service methods in camelCase instead of PascalCase.
- `customFileSuffix`: Set custom suffixes for generated files.
- `timeout`: Set the amount of time (in milliseconds) to wait for a response
from the server when downloading files. Default to 20 seconds.

### Configuration file example
The following is an example of a configuration file which will choose a few
tags to generate, and chose not to generate the `ApiModule` class:
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

This will generate only the services for the chosen tags, and also skip the
generation of any interfaces for models which are not used by any of the
generated services.

## Setting up a node script
Regardless If your Angular project was generated or is managed by
[Angular CLI](https://cli.angular.io/), or you have started your project with
some other seed (for example, using [webpack](https://webpack.js.org/)
directly), you can setup a script to make sure the generated API classes are
consistent with the swagger descriptor.

To do so, create the `ng-swagger-gen.json` configuration file and add the
following `scripts` to your `package.json`:
```json
{
  "scripts": {
    "start": "ng-swagger-gen && ng serve",
    "build": "ng-swagger-gen && ng build -prod"
  }
}
```
This way whenever you run `npm start` or `npm run build`, the API classes
will be generated before actually serving / building your application.

Also, if you use several configuration files, you can specify multiple times
the call to `ng-swagger-gen`, like:
```json
{
  "scripts": {
    "start": "ng-swagger-gen -c api1.json && ng-swagger-gen -c api2.json && ng serve",
    "build": "ng-swagger-gen -c api1.json && ng-swagger-gen -c api2.json && ng build -prod"
  }
}
```

## Specifying the root URL / web service endpoint
The easiest way to specify a custom root URL (web service endpoint URL) is to
use `forRoot` method of `ApiModule` and set the `rootUrl` property from there.

```typescript
@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    ApiModule.forRoot({rootUrl: 'https://some-root-url.com'}),
  ],
  bootstrap: [
    AppComponent
  ]
})
export class AppModule { }
```

Alternatively, you can inject the `ApiConfiguration` instance in some service
or component, such as the `AppComponent` and set the `rootUrl` property there.

## Passing request headers / customizing the request
To pass request headers, such as authorization or API keys, as well as having a
centralized error handling, a standard
[HttpInterceptor](https://angular.io/guide/http#intercepting-all-requests-or-responses) should
be used. It is basically an `@Injectable` that is called before each request,
and can customize both requests and responses.

Here is an example:

```typescript
@Injectable()
export class ApiInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Apply the headers
    req = req.clone({
      setHeaders: {
        'ApiToken': '234567890'
      }
    });

    // Also handle errors globally
    return next.handle(req).pipe(
      tap(x => x, err => {
        // Handle this err
        console.error(`Error performing request, status code = ${err.status}`);
      })
    );
  }
}
```

Then, both the `HttpInterceptor` implementation and the injection token
`HTTP_INTERCEPTORS` pointing to it must be provided in your application module,
like this:

```typescript
import { NgModule, Provider, forwardRef } from '@angular/core';
import { HTTP_INTERCEPTORS } from '@angular/common/http';

import { ApiInterceptor } from './api.interceptor';

export const API_INTERCEPTOR_PROVIDER: Provider = {
  provide: HTTP_INTERCEPTORS,
  useExisting: forwardRef(() => ApiInterceptor),
  multi: true
};

@NgModule({
  providers: [
    ApiInterceptor,
    API_INTERCEPTOR_PROVIDER
  ]
})
export class AppModule {}
```

Finer control over specific requests can also be achieved, such as:

- Set the immediate next request to use a BASIC authentication for login, and
  the subsequent ones to use a session key in another request header;
- Set the next request to not use the default error handling, and handle errors
  directly in the calling code.

To do so, just create another shared `@Injectable()`, for example, called
`ApiRequestConfiguration`, which has state for such special cases. Then inject
it on both the `HttpInterceptor` and in the client code that makes requests.
Here is an example for such class for controlling the authentication:

```typescript
import { Injectable } from '@angular/core';
import { HttpRequest } from '@angular/common/http';

/**
 * Configuration for the performed HTTP requests
 */
@Injectable()
export class ApiRequestConfiguration {
  private nextAuthHeader: string;
  private nextAuthValue: string;

  /** Set to basic authentication */
  basic(user: string, password: string): void {
    this.nextAuthHeader = 'Authorization';
    this.nextAuthValue = 'Basic ' + btoa(user + ':' + password);
  }

  /** Set to session key */
  nextAsSession(sessionKey: string): void {
    this.nextAuthHeader = 'Session';
    this.nextAuthValue = sessionKey;
  }

  /** Clear any authentication headers (to be called after logout) */
  clear(): void {
    this.nextAuthHeader = null;
    this.nextAuthValue = null;
  }

  /** Apply the current authorization headers to the given request */
  apply(req: HttpRequest<any>): HttpRequest<any> {
    const headers = {};
    if (this.nextAuthHeader) {
      headers[this.nextAuthHeader] = this.nextAuthValue;
    }
    // Apply the headers to the request
    return req.clone({
      setHeaders: headers
    });
  }
}
```

Then change the `ApiInterceptor` class to call the `apply` method.
And, of course, add `ApiRequestConfiguration` to your module `providers` and
inject it on your components or services.

## Swagger extensions
The swagger specification doesn't allow referencing an enumeration to be used
as an operation parameter. Hence, `ng-swagger-gen` supports the vendor
extension `x-type` in operations, whose value could either be a model name
representing an enumeration or `Array<EnumName>` or `List<EnumName>` (both are
equivalents) to use an array of models.

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
npm install --save-dev ng-swagger-gen
node_modules/.bin/ng-swagger-gen -i http://petstore.swagger.io/v2/swagger.json
```
