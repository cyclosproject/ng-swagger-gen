'use strict';

const fs = require('fs');
const url = require('url');
const http = require('http');
const https = require('https');
const path = require('path');
const Mustache = require('mustache');

/**
 * Main generate function
 */
function ngSwaggerGen(options) {
  if (typeof options.swagger != 'string') {
    console.error("Swagger file not specified in the 'swagger' option");
    process.exit(1);
  }

  var u = url.parse(options.swagger);
  var isHttp = u.protocol === 'http:';
  var isHttps = u.protocol === 'https:';
  if (isHttp || isHttps) {
    // The swagger definition is an HTTP(S) URL - fetch it
    (isHttp ? http : https).get(options.swagger, (res) => {
      const statusCode = res.statusCode;
      const contentType = res.headers['content-type'];

      if (statusCode !== 200) {
        console.error("Server responded with status code " + statusCode
          + " the request to " + options.swagger);
        process.exit(1);
      }

      res.setEncoding('utf8');
      var data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        // Proceed with the generation
        doGenerate(data, options);
      });
    }).on('error', (err) => {
      console.error("Error reading swagger JSON URL " + options.swagger
        + ": " + err.message);
      process.exit(1);
    });
  } else {
    // The swagger definition is a local file
    if (!fs.existsSync(options.swagger)) {
      console.error("Swagger definition file doesn't exist: " + options.swagger);
      process.exit(1);
    }
    fs.readFile(options.swagger, "UTF-8", (err, data) => {
      if (err) {
        console.error("Error reading swagger JSON file " + options.swagger
          + ": " + err.message);
        process.exit(1);
      } else {
        // Proceed with the generation
        doGenerate(data, options);
      }
    });
  }
}

/**
 * Proceedes with the generation given the swagger descriptor content
 */
function doGenerate(swaggerContent, options) {
  if (!options.templates) {
    options.templates = path.join(__dirname, 'templates');
  }

  var templates = options.templates;
  var output = options.output || 'src/app/api';

  var swagger = JSON.parse(swaggerContent);
  if (typeof swagger != 'object') {
    console.error("Invalid swagger content");
    process.exit(1);
  }
  if (swagger.swagger !== '2.0') {
    console.error("Invalid swagger specification. Must be a 2.0. Currently "
      + swagger.swagger);
    process.exit(1);
  }
  swagger.paths = swagger.paths || {};
  swagger.models = swagger.models || [];
  var models = processModels(swagger, options);
  var services = processServices(swagger, models, options);

  // Apply the tag filter. If includeTags is null, uses all services, 
  // but still removes unused models
  var includeTags = options.includeTags;
  if (typeof includeTags == 'string') {
    includeTags = includeTags.split(",");
  }
  applyTagFilter(models, services, includeTags, options);

  // Read the templates
  var templates = {}
  var files = fs.readdirSync(options.templates);
  files.forEach(function (file, index) {
    var pos = file.indexOf(".mustache");
    if (pos >= 0) {
      var fullFile = path.join(options.templates, file);
      templates[file.substr(0, pos)] = fs.readFileSync(fullFile, 'utf-8');
    }
  });

  // Prepare the output folder
  const modelsOutput = path.join(output, '/models');
  const servicesOutput = path.join(output, '/services');
  mkdirs(modelsOutput);
  mkdirs(servicesOutput);

  var removeStaleFiles = options.removeStaleFiles !== false;

  // Utility function to render a template and write it to a file
  var generate = function (template, model, file) {
    var code = Mustache.render(template, model, templates);
    fs.writeFileSync(file, code, "UTF-8");
    console.info("Wrote " + file);
  };

  // Write the models
  var modelsArray = [];
  for (var modelName in models) {
    var model = models[modelName];
    modelsArray.push(model);
    generate(templates.model, model,
      modelsOutput + "/" + model.modelFile + ".ts");
  }
  if (modelsArray.length > 0) {
    modelsArray[modelsArray.length - 1].modelIsLast = true;
  }
  if (removeStaleFiles) {
    var modelFiles = fs.readdirSync(modelsOutput);
    modelFiles.forEach((file, index) => {
      var ok = false;
      var basename = path.basename(file);
      for (var modelName in models) {
        var model = models[modelName];
        if (basename == model.modelFile + '.ts') {
          ok = true;
          break;
        }
      }
      if (!ok) {
        rmIfExists(path.join(modelsOutput, file));
      }
    });
  }

  // Write the model index
  var modelIndexFile = output + "/models.ts";
  if (options.modelIndex !== false) {
    generate(templates.models, { "models": modelsArray }, modelIndexFile);
  } else if (removeStaleFiles) {
    rmIfExists(modelIndexFile);
  }

  // Write the services
  var servicesArray = [];
  for (var serviceName in services) {
    var service = services[serviceName];
    service.generalErrorHandler = options.errorHandler !== false;
    servicesArray.push(service);
    generate(templates.service, service,
      servicesOutput + "/" + service.serviceFile + ".ts");
  }
  if (servicesArray.length > 0) {
    servicesArray[servicesArray.length - 1].serviceIsLast = true;
  }
  if (removeStaleFiles) {
    var serviceFiles = fs.readdirSync(servicesOutput);
    serviceFiles.forEach((file, index) => {
      var ok = false;
      var basename = path.basename(file);
      for (var serviceName in services) {
        var service = services[serviceName];
        if (basename == service.serviceFile + '.ts') {
          ok = true;
          break;
        }
      }
      if (!ok) {
        rmIfExists(path.join(servicesOutput, file));
      }
    });
  }

  // Write the service index
  var serviceIndexFile = output + "/services.ts";
  if (options.serviceIndex !== false) {
    generate(templates.services, { "services": servicesArray },
      serviceIndexFile);
  } else if (removeStaleFiles) {
    rmIfExists(serviceIndexFile);
  }

  // Write the api module
  var apiModuleFile = output + "/api.module.ts";
  if (options.apiModule !== false) {
    generate(templates.apiModule, { "services": servicesArray },
      apiModuleFile);
  } else if (removeStaleFiles) {
    rmIfExists(apiModuleFile);
  }

  // Write the ApiConfiguration
  {
    var schemes = swagger.schemes || [];
    var scheme = schemes.length == 0 ? 'http' : schemes[0];
    var host = (swagger.host || "localhost");
    var basePath = (swagger.basePath || "/");
    var rootUrl = scheme + "://" + host + basePath;
    var context = {
      "rootUrl": rootUrl,
      "generalErrorHandler": options.errorHandler !== false
    };
    generate(templates.apiConfiguration, context,
      output + "/api-configuration.ts");
  }

  // Write the ApiResponse
  {
    generate(templates.apiResponse, {}, output + "/api-response.ts");
  }
}

/**
 * Applies a filter over the given services, keeping only the specific tags.
 * Also optionally removes any unused models, even if includeTags is null (all).
 */
function applyTagFilter(models, services, includeTags, options) {
  var ignoreUnusedModels = options.ignoreUnusedModels !== false;
  // Normalize the tag names
  var included = null;
  if (includeTags && includeTags.length > 0) {
    included = [];
    for (var i = 0; i < includeTags.length; i++) {
        included.push(tagName(includeTags[i], options));
    }
  }
  var usedModels = new Set();
  for (var serviceName in services) {
    var include = !included || included.indexOf(serviceName) >= 0;
    if (!include) {
      // This service is skipped - remove it
      console.info("Ignoring service " + serviceName
        + " because it was not included");
      delete services[serviceName];
    } else if (ignoreUnusedModels) {
      // Collect the models used by this service
      var service = services[serviceName];
      service.serviceDependencies.forEach((dep, index) => usedModels.add(dep));
    }
  }

  if (ignoreUnusedModels) {
    // Collect the model dependencies of models, so unused can be removed
    var allDependencies = new Set();
    usedModels.forEach(
      dep => collectDependencies(allDependencies, dep, models));

    // Remove all models that are unused
    for (var modelName in models) {
      if (!allDependencies.has(modelName)) {
        // This model is not used - remove it
        console.info("Ignoring model " + modelName
          + " because it was not used by any service");
        delete models[modelName];
      }
    }
  }
}

/**
 * Collects on the given dependencies set all dependencies of the given model
 */
function collectDependencies(dependencies, model, models) {
  if (!model || dependencies.has(model.modelName)) {
    return;
  }
  dependencies.add(model.modelName);
  if (model.modelDependencies) {
    model.modelDependencies.forEach((dep, index) =>
      collectDependencies(dependencies, dep, models));
  }
}

/**
 * Creates all sub-directories for a nested path
 * Thanks to https://github.com/grj1046/node-mkdirs/blob/master/index.js
 */
function mkdirs(folderPath, mode) {
  var folders = [];
  var tmpPath = path.normalize(folderPath);
  var exists = fs.existsSync(tmpPath);
  while (!exists) {
    folders.push(tmpPath);
    tmpPath = path.join(tmpPath, '..');
    exists = fs.existsSync(tmpPath);
  }

  for (var i = folders.length - 1; i >= 0; i--) {
    fs.mkdirSync(folders[i], mode);
  }
}

/**
 * Removes the given file if it exists (logging the action)
 */
function rmIfExists(file) {
  if (fs.existsSync(file)) {
    console.info("Removing stale file " + file);
    fs.unlinkSync(file);
  }
}

/**
 * Converts a given type name into a TS file name
 */
function toFileName(typeName) {
  var result = "";
  var wasLower = false;
  for (var i = 0; i < typeName.length; i++) {
    var c = typeName.charAt(i);
    var isLower = /[a-z]/.test(c);
    if (!isLower && wasLower) {
      result += "-";
    }
    result += c.toLowerCase();
    wasLower = isLower;
  }
  return result;
}

/**
 * Resolves the simple reference name from a qualified reference
 */
function simpleRef(ref) {
  if (!ref) {
    return null;
  }
  var index = ref.lastIndexOf('/');
  if (index >= 0) {
    return ref.substr(index + 1);
  } else {
    return ref;
  }
}

/**
* Converts a given enum value into the enum name
*/
function toEnumName(value) {
  var result = "";
  var wasLower = false;
  for (var i = 0; i < value.length; i++) {
    var c = value.charAt(i);
    var isLower = /[a-z]/.test(c);
    if (!isLower && wasLower) {
      result += "_";
    }
    result += c.toUpperCase();
    wasLower = isLower;
  }
  return result;
}

/**
 * Returns a multi-line comment for the given text
 */
function toComments(text, level) {
  var indent = "";
  for (var i = 0; i < level; i++) {
    indent += "  ";
  }
  var result = indent + "/**\n";
  var lines = (text || "").split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.length > 0) {
      result += indent + " * " + line + "\n";
    }
  }
  result += indent + " */";
  return result;
}

/**
 * Class used to resolve the model dependencies
 */
function DependenciesResolver(models, ownType) {
  this.models = models;
  this.ownType = ownType;
  this.dependencies = [];
  this.dependencyNames = [];
}
/**
 * Adds a candidate dependency
 */
DependenciesResolver.prototype.add = function (dep) {
  dep = removeBrackets(dep);
  if (this.dependencyNames.indexOf(dep) < 0 && dep !== this.ownType) {
    var depModel = this.models[dep];
    if (depModel) {
      this.dependencies.push(depModel);
      this.dependencyNames.push(dep);
    }
  }
}
/**
 * Returns the resolved dependencies as a list of models
 */
DependenciesResolver.prototype.get = function () {
  return this.dependencies;
}

/**
 * Process each model, returning an object keyed by model name, whose values
 * are simplified descriptors for models.
 */
function processModels(swagger, options) {
  var models = {};
  for (var name in swagger.definitions) {
    var model = swagger.definitions[name];
    var parent = null;
    var properties = null;
    var requiredProperties = null;
    var enumValues = null;
    var elementType = null;
    if (model.allOf != null && model.allOf.length > 0) {
      parent = simpleRef((model.allOf[0] || {}).$ref);
      properties = (model.allOf[1] || {}).properties || {};
      requiredProperties = (model.allOf[1] || {}).required || [];
    } else if (model.type === 'string') {
      enumValues = model.enum || [];
      if (enumValues.length == 0) {
        console.error("Enum " + name + " has no possible values");
        process.exit(1);
      } else {
        for (var i = 0; i < enumValues.length; i++) {
          var enumValue = enumValues[i];
          var enumDescriptor = {
            "enumName": toEnumName(enumValue),
            "enumValue": enumValue,
            "enumIsLast": i === enumValues.length - 1
          }
          enumValues[i] = enumDescriptor;
        }
      }
    } else if (model.type === 'array') {
      elementType = propertyType(model);
    } else if (model.type === 'object' || model.type === undefined) {
      properties = model.properties || {};
      requiredProperties = model.required || [];
    } else {
      console.error("Unhandled model type for " + name);
      process.exit(1);
    }
    var descriptor = {
      "modelName": name,
      "modelClass": name,
      "modelFile": toFileName(name),
      "modelComments": toComments(model.description),
      "modelParent": parent,
      "modelIsObject": properties != null,
      "modelIsEnum": enumValues != null,
      "modelIsArray": elementType != null,
      "properties": properties == null ? null :
        processProperties(swagger, properties, requiredProperties),
      "modelEnumValues": enumValues,
      "modelElementType": elementType,
      "modelSubclasses": []
    };

    if (descriptor.properties != null) {
      descriptor.modelProperties = [];
      for (var propertyName in descriptor.properties) {
        var property = descriptor.properties[propertyName];
        descriptor.modelProperties.push(property);
      }
      descriptor.modelProperties.sort((a, b) => {
        return a.modelName < b.modelName
          ? -1 : a.modelName > b.modelName ? 1 : 0;
      });
      if (descriptor.modelProperties.length > 0) {
        descriptor.modelProperties[descriptor.modelProperties.length - 1]
          .propertyIsLast = true;
      }
    }

    models[name] = descriptor;
  }

  // Now that we know all models, process the hierarchies
  for (var name in models) {
    var model = models[name];
    if (!model.modelIsObject) {
      // Only objects can have hierarchies
      continue;
    }

    // Process the hierarchy
    var parentName = model.modelParent;
    if (parentName) {
      // Make the parent be the actual model, not the name
      model.modelParent = models[parentName];

      // Append this model on the parent's subclasses
      model.modelParent.modelSubclasses.push(model);
    }
  }

  // Now that the model hierarchy is ok, resolve the dependencies
  for (var name in models) {
    var model = models[name];
    if (model.modelIsEnum) {
      // Enums have no dependencies
      continue;
    }
    var dependencies = new DependenciesResolver(models, model.modelName);

    // The parent is a dependency
    if (model.modelParent) {
      dependencies.add(model.modelParent.modelName);
    }

    // The subclasses are dependencies
    if (model.modelSubclasses) {
      for (var i = 0; i < model.modelSubclasses.length; i++) {
        var child = model.modelSubclasses[i];
        dependencies.add(child.modelName);
      }
    }

    // Each property may add a dependency
    if (model.modelProperties) {
      for (var i = 0; i < model.modelProperties.length; i++) {
        var property = model.modelProperties[i];
        var type = property.propertyType;
        if (type.allTypes) {
          // This is an inline object. Append all types
          type.allTypes.forEach((t, i) => dependencies.add(t));
        } else {
          dependencies.add(type);
        }
      }
    }

    // If an array, the element type is a dependency
    if (model.modelElementType) {
      dependencies.add(model.modelElementType)
    }

    model.modelDependencies = dependencies.get();
  }

  return models;
}

/**
 * Removes an array designation from the given type.
 * For example, "a[]" returns "a", while "b" returns "b".
 * A special case is for inline objects. In this case, the result is "object".
 */
function removeBrackets(type) {
  if (typeof type == "object") {
    return "object";
  }
  var pos = (type || "").indexOf("[");
  return pos >= 0 ? type.substr(0, pos) : type;
}

/**
 * Returns the TypeScript property type for the given raw property
 */
function propertyType(property) {
  if (property == null) {
    return "void";
  } else if (property.$ref != null) {
    // Type is a reference
    return simpleRef(property.$ref);
  } else if (property["x-type"]) {
    // Type is read from the x-type vendor extension
    var type = (property["x-type"] || "").toString().replace("List<", "Array<");
    var pos = type.indexOf("Array<");
    if (pos >= 0) {
      type = type.substr("Array<".length, type.length);
      type = type.substr(0, type.length - 1) + "[]";
    }
    return type.length == 0 ? 'void' : type;
  }
  switch (property.type) {
    case "string":
      return "string";
    case "array":
      return propertyType(property.items) + "[]";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      var def = "{";
      var first = true;
      var allTypes = [];
      if (property.properties) {
        for (var name in property.properties) {
          var prop = property.properties[name];
          if (first) {
            first = false;
          } else {
            def += ", ";
          }
          var type = propertyType(prop);
          if (allTypes.indexOf(type) < 0) {
            allTypes.push(type);
          }
          def += name + ": " + type;
        }
      }
      if (property.additionalProperties) {
        if (!first) {
          def += ", ";
        }
        var type = propertyType(property.additionalProperties);
        if (allTypes.indexOf(type) < 0) {
          allTypes.push(type);
        }
        def += "[key: string]: " + type;
      }
      def += "}";
      return {
        allTypes: allTypes,
        toString: () => def
      };
    default:
      return "any";
  }
}

/**
 * Process each property for the given properties object, returning an object
 * keyed by property name with simplified property types
 */
function processProperties(swagger, properties, requiredProperties) {
  var result = {};
  for (var name in properties) {
    var property = properties[name];
    var descriptor = {
      "propertyName": name,
      "propertyComments": toComments(property.description),
      "propertyRequired": requiredProperties.indexOf(name) >= 0,
      "propertyType": propertyType(property)
    }
    result[name] = descriptor;
  }
  return result;
}

/**
 * Resolves a local reference in the given swagger file
 */
function resolveRef(swagger, ref) {
  if (ref.indexOf("#/") != 0) {
    console.error("Resolved references must start with #/. Current: " + ref);
    process.exit(1);
  }
  var parts = ref.substr(2).split("/");
  var result = swagger;
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    result = result[part];
  }
  return result === swagger ? {} : result;
}

/*
 * Process an operation's possible responses. Returns an object keyed
 * by each HTTP code, whose values are objects with code and type properties,
 * plus a property resultType, which is the type to the HTTP 2xx code.
 */
function processResponses(def, path, models) {
  var responses = def.responses || {};
  var operationResponses = {};
  for (var code in responses) {
    var response = responses[code];
    if (!response.schema) {
      continue;
    }
    var type = propertyType(response.schema);
    if (/2\d\d/.test(code)) {
      // Successful response
      operationResponses.resultType = type;
    }
    operationResponses[code] = {
      "code": code,
      "type": type
    };
  }
  if (!operationResponses.resultType) {
    operationResponses.resultType = 'void';
  }
  return operationResponses;
}

/**
 * Returns a path expression to be evaluated, for example:
 * "/a/{var1}/b/{var2}/" returns "/a/${params.var1}/b/${params.var2}"
 * if there is a parameters class, or "/a/${var1}/b/${var2}" otherwise.
 */
function toPathExpression(paramsClass, path) {
  var repl = paramsClass == null ? "${" : "${params.";
  return (path || "").replace("{", repl);
}

/**
 * Transforms the given string into a valid identifier
 */
function toIdentifier(string) {
  var result = "";
  var wasSep = false;
  for (var i = 0; i < string.length; i++) {
    var c = string.charAt(i)
    if (/[a-z|A-Z|0-9]/.test(c)) {
      if (wasSep) {
        c = c.toUpperCase();
        wasSep = false;
      }
      result += c;
    } else {
      wasSep = true;
    }
  }
  return result;
}

/**
 * Normalizes the tag name. Actually, capitalizes the given name.
 * If the given tag is null, returns the default from options
 */
function tagName(tag, options) {
  if (tag == null || tag === '') {
    tag = options.defaultTag || "Api";
  }
  return tag.charAt(0).toUpperCase() + (tag.length == 1 ? "" : tag.substr(1));
}

/**
 * Process API paths, returning an object with descriptors keyed by tag name.
 * It is required that operations define a single tag, or they are ignored.
 */
function processServices(swagger, models, options) {
  var services = {};
  var minParamsForContainer = options.minParamsForContainer || 2;
  for (var url in swagger.paths) {
    var path = swagger.paths[url];
    for (var method in (path || {})) {
      var def = path[method];
      if (!def) {
        continue;
      }
      var id = def.operationId;
      if (id == null) {
        // Generate an id if none
        id = toIdentifier(method + url);
        console.warn("Operation '" + method + "' on '" + url 
          + "' defines no operationId. " + "Assuming '" + id + "'.");
      }
      var tags = def.tags || [];
      var tag = tagName(tags.length == 0 ? null : tags[0], options);
      var descriptor = services[tag];
      if (descriptor == null) {
        descriptor = {
          "serviceName": tag,
          "serviceClass": tag + "Service",
          "serviceFile": toFileName(tag) + ".service",
          "serviceOperations": []
        };
        services[tag] = descriptor;
      }

      var parameters = def.parameters || [];

      var paramsClass = parameters.length < minParamsForContainer
        ? null : id.charAt(0).toUpperCase() + id.substr(1) + "Params";

      var operationParameters = [];
      for (var p = 0; p < parameters.length; p++) {
        var param = parameters[p];
        if (param.$ref) {
          param = resolveRef(swagger, param.$ref);
        }
        var paramType;
        if (param.schema) {
          paramType = propertyType(param.schema);
        } else {
          paramType = propertyType(param);
        }
        var paramVar = toIdentifier(param.name);
        var paramDescriptor = {
          "paramName": param.name,
          "paramIn": param.in,
          "paramVar": paramVar,
          "paramFullVar": (paramsClass == null ? "" : "params.") + paramVar,
          "paramRequired": param.required === true || param.in === 'path',
          "paramIsQuery": param.in === 'query',
          "paramIsPath": param.in === 'path',
          "paramIsHeader": param.in === 'header',
          "paramIsBody": param.in === 'body',
          "paramIsArray": param.type === 'array',
          "paramDescription": param.description,
          "paramComments": toComments(param.description, 1),
          "paramType": paramType,
          "paramCollectionFormat": param.collectionFormat
        };
        operationParameters.push(paramDescriptor);
      }
      operationParameters.sort((a, b) => {
        if (a.paramRequired && !b.paramRequired) return -1;
        if (!a.paramRequired && b.paramRequired) return 1;
        return a.paramName > b.paramName
          ? -1 : a.paramName < b.paramName ? 1 : 0;
      });
      if (operationParameters.length > 0) {
        operationParameters[operationParameters.length - 1].paramIsLast = true;
      }
      var operationResponses = processResponses(def, path, models);
      var resultType = operationResponses.resultType;
      var docString = def.description || "";
      for (var i = 0; i < operationParameters.length; i++) {
        var param = operationParameters[i];
        docString += "\n@param " + param.paramName + " - "
          + param.paramDescription;
      }
      var operation = {
        "operationName": id,
        "operationParamsClass": paramsClass,
        "operationMethod": method.toLocaleLowerCase(),
        "operationPath": url,
        "operationPathExpression": toPathExpression(paramsClass, url),
        "operationComments": toComments(docString, 1),
        "operationResultType": resultType,
        "operationParameters": operationParameters,
        "operationResponses": operationResponses
      }
      operation.operationIsVoid = resultType === 'void';
      operation.operationIsString = resultType === 'string';
      operation.operationIsNumber = resultType === 'number';
      operation.operationIsBoolean = resultType === 'boolean';
      var modelResult = models[removeBrackets(resultType)];
      operation.operationIsEnum = modelResult && modelResult.modelIsEnum;
      operation.operationIsObject = modelResult && modelResult.modelIsObject;
      operation.operationIsPrimitiveArray = !modelResult && 
        resultType.toString().indexOf('[]') >= 0;
      operation.operationIsUnknown = !(operation.operationIsVoid
        || operation.operationIsString || operation.operationIsNumber
        || operation.operationIsBoolean || operation.operationIsEnum
        || operation.operationIsObject || operation.operationIsPrimitiveArray);
      descriptor.serviceOperations.push(operation);
    }
  }

  // Resolve the models used by each
  for (var name in services) {
    var service = services[name];
    var dependencies = new DependenciesResolver(models);
    for (var i = 0; i < service.serviceOperations.length; i++) {
      var op = service.serviceOperations[i];
      for (var code in op.operationResponses) {
        var response = op.operationResponses[code]
        dependencies.add(response.type);
      }
      for (var j = 0; j < op.operationParameters.length; j++) {
        var param = op.operationParameters[j];
        dependencies.add(param.paramType);
      }
    }
    service.serviceDependencies = dependencies.get();
  }

  return services;
}

module.exports = ngSwaggerGen;
