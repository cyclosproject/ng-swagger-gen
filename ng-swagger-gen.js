'use strict';

const fs = require('fs');
const url = require('url');
const http = require('http');
const path = require('path');
const Mustache = require('mustache');

/**
 * Main generate function
 */
function ngSwaggerGen(options) {
  if (typeof options.swagger != 'string') {
    console.log("Swagger file not specified in the 'swagger' option");
    process.exit(1);
  }

  var u = url.parse(options.swagger);
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    // The swagger definition is an HTTP URL - fetch it
    http.get(options.swagger, (res) => {
      const statusCode = res.statusCode;
      const contentType = res.headers['content-type'];

      if (statusCode !== 200) {
        console.log("Server responded with status code " + statusCode + " the request to " + options.swagger);
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
        console.log("Error reading swagger JSON URL " + options.swagger + ": " + err.message);
        process.exit(1);
    });
  } else {
    // The swagger definition is a local file
    if (!fs.existsSync(options.swagger)) {
      console.log("Swagger definition file doesn't exist: " + options.swagger);
      process.exit(1);
    }
    fs.readFile(options.swagger, "UTF-8", (err, data) => {
      if (err) {
        console.log("Error reading swagger JSON file " + options.swagger + ": " + err.message);
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
  var templates = options.templates || 'templates';
  var output = options.output || 'src/app/api';

  var swagger = JSON.parse(swaggerContent);
  if (typeof swagger != 'object') {
    console.log("Invalid swagger content");
    process.exit(1);
  }
  if (swagger.swagger !== '2.0') {
    console.log("Invalid swagger specification. Must be a 2.0. Currently " + swagger.swagger);
    process.exit(1);
  }
  swagger.paths = swagger.paths || {};
  swagger.models = swagger.models || [];
  var models = processModels(swagger);
  var services = processServices(swagger, models);

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
  const modelsOutput = output + '/models';
  const servicesOutput = output + '/services';

  //if (fs.existsSync(output)) rmdirRecursive(output);
  if (!fs.existsSync(output)) fs.mkdirSync(output);
  if (!fs.existsSync(modelsOutput)) fs.mkdirSync(modelsOutput);
  if (!fs.existsSync(servicesOutput)) fs.mkdirSync(servicesOutput);

  // Utility function to render a template and write it to a file
  var generate = function (template, model, file) {
    var code = Mustache.render(template, model, templates);
    fs.writeFileSync(file, code, "UTF-8");
    console.log("Wrote " + file);
  };

  // Write the models
  var modelsArray = [];
  for (var modelName in models) {
    var model = models[modelName];
    modelsArray.push(model);
    generate(templates.model, model, modelsOutput + "/" + model.modelFile + ".ts");
  }
  if (modelsArray.length > 0) {
    modelsArray[modelsArray.length - 1].last = true;
  }

  // Write the model index
  {
    generate(templates.models, { "models": modelsArray }, output + "/models.ts");
  }

  // Write the services
  var servicesArray = [];
  for (var serviceName in services) {
    var service = services[serviceName];
    servicesArray.push(service);
    generate(templates.service, service, servicesOutput + "/" + service.serviceFile + ".ts");
  }
  if (servicesArray.length > 0) {
    servicesArray[servicesArray.length - 1].last = true;
  }

  // Write the service index
  {
    generate(templates.services, { "services": servicesArray }, output + "/services.ts");
  }

  // Write the api module
  {
    generate(templates.apiModule, { "services": servicesArray }, output + "/api.module.ts");
  }

  // Write the ApiConfiguration
  {
    generate(templates.apiConfiguration, {}, output + "/api-configuration.ts");
  }
}

/**
 * Recursively removes a directory with all its subfolders / files
 */
function rmdirRecursive(dir) {
  if (fs.existsSync(dir)) {
    var files = fs.readdirSync(dir);
    files.forEach(function (file, index) {
      var curPath = path.join(dir, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        rmdirRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(dir);
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
function processModels(swagger) {
  var models = {};
  for (var name in swagger.definitions) {
    var model = swagger.definitions[name];
    var parent = null;
    var properties = null;
    var requiredProperties = null;
    var enumValues = null;
    if (model.allOf != null && model.allOf.length > 0) {
      parent = simpleRef((model.allOf[0] || {}).$ref);
      properties = (model.allOf[1] || {}).properties || {};
      requiredProperties = (model.allOf[1] || {}).required || [];
    } else if (model.type === 'object') {
      properties = model.properties || {};
      requiredProperties = model.required || [];
    } else if (model.type === 'string') {
      enumValues = model.enum || [];
      if (enumValues.length == 0) {
        console.log("Enum " + name + " has no possible values");
        process.exit(1);
      } else {
        for (var i = 0; i < enumValues.length; i++) {
          var enumValue = enumValues[i];
          var enumDescriptor = {
            "enumName": toEnumName(enumValue),
            "enumValue": enumValue,
            "last": i === enumValues.length - 1
          }
          enumValues[i] = enumDescriptor;
        }
      }
    } else {
      console.log("Unhandled model type for " + name);
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
      "properties": properties == null ? null :
        processProperties(swagger, properties, requiredProperties),
      "modelEnumValues": enumValues
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
          .last = true;
      }
    }

    models[name] = descriptor;
  }

  // Now that we know all modules, resolve the dependencies
  for (var name in models) {
    var model = models[name];
    if (!model.modelIsObject) {
      // Only objects can have dependencies
      continue;
    }
    var dependencies = new DependenciesResolver(models, model.modelName);
    dependencies.add(model.modelParent);

    for (var i = 0; i < model.modelProperties.length; i++) {
      var property = model.modelProperties[i];
      dependencies.add(property.propertyType);
    }
    model.modelDependencies = dependencies.get();
  }

  return models;
}

/**
 * Removes an array designation from the given type.
 * For example, "a[]" returns "a", while "b" returns "b".
 */
function removeBrackets(type) {
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
    return simpleRef(property.$ref);
  }
  switch (property.type) {
    case "array":
      return propertyType(property.items) + "[]";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "Boolean";
    default:
      return "string";
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
    console.log("Resolved references must start with #/. Current: " + ref);
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
 * Returns the operation result type
 */
function processResultType(def, path, models) {
  var responses = def.responses || {};
  for (var code in responses) {
    if (/2\d\d/.test(code)) {
      // Successful response
      return propertyType(responses[code].schema);
    }
  }
  return "void";
}

/**
 * Returns a path expression to be evaluated, for example:
 * "/a/{var1}/b/{var2}/" returns "/a/${params.var1}/b/${params.var2}"
 */
function toPathExpression(path) {
  return (path || "").replace("{", "${params.");
}

/**
 * Process API paths, returning an object with descriptors keyed by tag name.
 * It is required that operations define a single tag, or they are ignored.
 */
function processServices(swagger, models) {
  var services = {};
  for (var url in swagger.paths) {
    var path = swagger.paths[url];
    for (var method in (path || {})) {
      var def = path[method];
      if (!def) {
        continue;
      }
      var tags = def.tags || [];
      if (tags.length == 0) {
        console.log("Ignoring " + name + "." + method
          + " because it has no tags");
        continue;
      } else if (tags.length > 1) {
        console.log("Ignoring " + name + "." + method
          + " because it has multiple tags: " + tags);
        continue;
      }
      var tag = tags[0];
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

      var id = def.operationId;
      if (id == null) {
        console.log("Ignoring " + name + "." + method
          + " because it has no id");
        continue;
      }
      var operationParameters = [];
      for (var p = 0; p < def.parameters.length; p++) {
        var param = def.parameters[p];
        if (param.$ref) {
          param = resolveRef(swagger, param.$ref);
        }
        var paramDescriptor = {
          "paramName": param.name,
          "paramIn": param.in,
          "paramRequired": param.required === true || param.in === 'path',
          "paramIsQuery": param.in === 'query',
          "paramIsPath": param.in === 'path',
          "paramIsHeader": param.in === 'header',
          "paramIsBody": param.in === 'body',
          "paramIsArray": param.type === 'array',
          "paramDescription": param.description,
          "paramComments": toComments(param.description, 1),
          "paramType": propertyType(param),
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
        operationParameters[operationParameters.length - 1].last = true;
      }
      var paramsClass = operationParameters.length == 0
        ? null : id.charAt(0).toUpperCase() + id.substr(1) + "Params";
      var resultType = processResultType(def, path, models);
      var docString = def.description || "";
      for (var i = 0; i < operationParameters.length; i++) {
        var param = operationParameters[i];
        docString += "\n@param " + param.paramName + " - " + param.paramDescription;
      }
      var operation = {
        "operationName": id,
        "operationParamsClass": paramsClass,
        "operationMethod": method.toLocaleLowerCase(),
        "operationPath": url,
        "operationPathExpression": toPathExpression(url),
        "operationComments": toComments(docString, 1),
        "operationResultType": resultType,
        "operationParameters": operationParameters
      }
      operation.operationIsVoid = resultType === 'void';
      operation.operationIsString = resultType === 'string';
      operation.operationIsNumber = resultType === 'number';
      operation.operationIsBoolean = resultType === 'boolean';
      var modelResult = models[removeBrackets(resultType)];
      operation.operationIsEnum = modelResult && modelResult.modelIsEnum;
      operation.operationIsObject = modelResult && modelResult.modelIsObject;
      operation.operationIsUnknown = !(operation.operationIsVoid
        || operation.operationIsString || operation.operationIsNumber
        || operation.operationIsBoolean || operation.operationIsEnum
        || operation.operationIsObject);
      descriptor.serviceOperations.push(operation);
    }
    services[tag] = descriptor;

    // Resolve the models used by the service
    var dependencies = new DependenciesResolver(models);
    for (var i = 0; i < descriptor.serviceOperations.length; i++) {
      var op = descriptor.serviceOperations[i];
      dependencies.add(op.operationResultType);
      for (var j = 0; j < op.operationParameters.length; j++) {
        var param = op.operationParameters[j];
        dependencies.add(param.paramType);
      }
    }
    descriptor.serviceDependencies = dependencies.get();
  }
  return services;
}

module.exports = ngSwaggerGen;
