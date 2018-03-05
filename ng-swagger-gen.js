'use strict';

const fs = require('fs');
const url = require('url');
const http = require('http');
const https = require('https');
const path = require('path');
const Mustache = require('mustache');
const $RefParser = require('json-schema-ref-parser');

/**
 * Main generate function
 */
function ngSwaggerGen(options) {
  if (typeof options.swagger != 'string') {
    console.error("Swagger file not specified in the 'swagger' option");
    process.exit(1);
  }

  $RefParser.bundle(options.swagger, { dereference: { circular: false } }).then(
    data => {
      doGenerate(data, options);
    },
    err => {
      console.error(
        `Error reading swagger location ${options.swagger}: ${err}`
      );
    }
  );
}

/**
 * Proceedes with the generation given the parsed swagger object
 */
function doGenerate(swagger, options) {
  if (!options.templates) {
    options.templates = path.join(__dirname, 'templates');
  }

  var output = options.output || 'src/app/api';

  if (swagger.swagger !== '2.0') {
    console.error(
      'Invalid swagger specification. Must be a 2.0. Currently ' +
        swagger.swagger
    );
    process.exit(1);
  }
  swagger.paths = swagger.paths || {};
  swagger.models = swagger.models || [];
  var models = processModels(swagger, options);
  var services = processServices(swagger, models, options);

  // Apply the tag filter. If includeTags is null, uses all services,
  // but still can remove unused models
  const includeTags = options.includeTags;
  if (typeof includeTags == 'string') {
    options.includeTags = includeTags.split(',');
  }
  const excludeTags = options.excludeTags;
  if (typeof excludeTags == 'string') {
    options.excludeTags = excludeTags.split(',');
  }
  applyTagFilter(models, services, options);

  // Read the templates
  var templates = {};
  var files = fs.readdirSync(options.templates);
  files.forEach(function(file, index) {
    var pos = file.indexOf('.mustache');
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
  var generate = function(template, model, file) {
    var code = Mustache.render(template, model, templates);
    fs.writeFileSync(file, code, 'UTF-8');
    console.info('Wrote ' + file);
  };

  // Write the models
  var modelsArray = [];
  for (var modelName in models) {
    var model = models[modelName];
    modelsArray.push(model);
    generate(
      templates.model,
      model,
      modelsOutput + '/' + model.modelFile + '.ts'
    );
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
  var modelIndexFile = output + '/models.ts';
  if (options.modelIndex !== false) {
    generate(templates.models, { models: modelsArray }, modelIndexFile);
  } else if (removeStaleFiles) {
    rmIfExists(modelIndexFile);
  }

  // Write the services
  var servicesArray = [];
  for (var serviceName in services) {
    var service = services[serviceName];
    service.generalErrorHandler = options.errorHandler !== false;
    servicesArray.push(service);
    generate(
      templates.service,
      service,
      servicesOutput + '/' + service.serviceFile + '.ts'
    );
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
  var serviceIndexFile = output + '/services.ts';
  if (options.serviceIndex !== false) {
    generate(templates.services, { services: servicesArray }, serviceIndexFile);
  } else if (removeStaleFiles) {
    rmIfExists(serviceIndexFile);
  }

  // Write the api module
  var apiModuleFile = output + '/api.module.ts';
  if (options.apiModule !== false) {
    generate(templates.apiModule, { services: servicesArray }, apiModuleFile);
  } else if (removeStaleFiles) {
    rmIfExists(apiModuleFile);
  }

  // Write the ApiConfiguration
  {
    var schemes = swagger.schemes || [];
    var scheme = schemes.length == 0 ? 'http' : schemes[0];
    var host = swagger.host || 'localhost';
    var basePath = swagger.basePath || '/';
    var rootUrl = scheme + '://' + host + basePath;
    var context = {
      rootUrl: rootUrl,
    };
    generate(
      templates.apiConfiguration,
      context,
      output + '/api-configuration.ts'
    );
  }

  // Write the BaseService
  {
    generate(templates.baseService, {}, output + '/base-service.ts');
  }
}

/**
 * Applies a filter over the given services, keeping only the specific tags.
 * Also optionally removes any unused models, even services are filtered.
 */
function applyTagFilter(models, services, options) {
  var i;
  // Normalize the included tag names
  const includeTags = options.includeTags;
  var included = null;
  if (includeTags && includeTags.length > 0) {
    included = [];
    for (i = 0; i < includeTags.length; i++) {
      included.push(tagName(includeTags[i], options));
    }
  }
  // Normalize the excluded tag names
  const excludeTags = options.excludeTags;
  var excluded = null;
  if (excludeTags && excludeTags.length > 0) {
    excluded = [];
    for (i = 0; i < excludeTags.length; i++) {
      excluded.push(tagName(excludeTags[i], options));
    }
  }
  // Filter out the unused models
  var ignoreUnusedModels = options.ignoreUnusedModels !== false;
  var usedModels = new Set();
  const addToUsed = (dep, index) => usedModels.add(dep);
  for (var serviceName in services) {
    var include =
      (!included || included.indexOf(serviceName) >= 0) &&
      (!excluded || excluded.indexOf(serviceName) < 0);
    if (!include) {
      // This service is skipped - remove it
      console.info(
        'Ignoring service ' + serviceName + ' because it was not included'
      );
      delete services[serviceName];
    } else if (ignoreUnusedModels) {
      // Collect the models used by this service
      var service = services[serviceName];
      service.serviceDependencies.forEach(addToUsed);
    }
  }

  if (ignoreUnusedModels) {
    // Collect the model dependencies of models, so unused can be removed
    var allDependencies = new Set();
    usedModels.forEach(dep =>
      collectDependencies(allDependencies, dep, models)
    );

    // Remove all models that are unused
    for (var modelName in models) {
      if (!allDependencies.has(modelName)) {
        // This model is not used - remove it
        console.info(
          'Ignoring model ' +
            modelName +
            ' because it was not used by any service'
        );
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
      collectDependencies(dependencies, dep, models)
    );
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
    console.info('Removing stale file ' + file);
    fs.unlinkSync(file);
  }
}

/**
 * Converts a given type name into a TS file name
 */
function toFileName(typeName) {
  var result = '';
  var wasLower = false;
  for (var i = 0; i < typeName.length; i++) {
    var c = typeName.charAt(i);
    var isLower = /[a-z]/.test(c);
    if (!isLower && wasLower) {
      result += '-';
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
  var result = '';
  var wasLower = false;
  for (var i = 0; i < value.length; i++) {
    var c = value.charAt(i);
    var isLower = /[a-z]/.test(c);
    if (!isLower && wasLower) {
      result += '_';
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
  var indent = '';
  var i;
  for (i = 0; i < level; i++) {
    indent += '  ';
  }
  if (text == null || text.length === 0) {
    return indent;
  }
  const lines = text.trim().split('\n');
  var result = indent + '/**\n';
  lines.forEach(line => {
    result += indent + ' *' + (line === '' ? '' : ' ' + line) + '\n';
  });
  result += indent + ' */\n ' + indent;
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
DependenciesResolver.prototype.add = function(dep) {
  dep = removeBrackets(dep);
  if (this.dependencyNames.indexOf(dep) < 0 && dep !== this.ownType) {
    var depModel = this.models[dep];
    if (depModel) {
      this.dependencies.push(depModel);
      this.dependencyNames.push(dep);
    }
  }
};
/**
 * Returns the resolved dependencies as a list of models
 */
DependenciesResolver.prototype.get = function() {
  return this.dependencies;
};

/**
 * Process each model, returning an object keyed by model name, whose values
 * are simplified descriptors for models.
 */
function processModels(swagger, options) {
  var name, model, i, property;
  var models = {};
  for (name in swagger.definitions) {
    model = swagger.definitions[name];
    var parent = null;
    var properties = null;
    var requiredProperties = null;
    var enumValues = null;
    var elementType = null;
    var simpleType = null;
    if (model.allOf != null && model.allOf.length > 0) {
      parent = simpleRef((model.allOf[0] || {}).$ref);
      properties = (model.allOf[1] || {}).properties || {};
      requiredProperties = (model.allOf[1] || {}).required || [];
    } else if (model.type === 'string') {
      enumValues = model.enum || [];
      if (enumValues.length == 0) {
        simpleType = 'string';
        enumValues = null;
      } else {
        for (i = 0; i < enumValues.length; i++) {
          var enumValue = enumValues[i];
          var enumDescriptor = {
            enumName: toEnumName(enumValue),
            enumValue: enumValue,
            enumIsLast: i === enumValues.length - 1,
          };
          enumValues[i] = enumDescriptor;
        }
      }
    } else if (model.type === 'array') {
      elementType = propertyType(model);
    } else if (model.type === 'object' || model.type === undefined) {
      properties = model.properties || {};
      requiredProperties = model.required || [];
    } else {
      simpleType = propertyType(model);
    }
    var descriptor = {
      modelName: name,
      modelClass: name,
      modelFile: toFileName(name),
      modelComments: toComments(model.description),
      modelParent: parent,
      modelIsObject: properties != null,
      modelIsEnum: enumValues != null,
      modelIsArray: elementType != null,
      modelIsSimple: simpleType != null,
      modelSimpleType: simpleType,
      properties:
        properties == null
          ? null
          : processProperties(swagger, properties, requiredProperties),
      modelEnumValues: enumValues,
      modelElementType: elementType,
      modelSubclasses: [],
    };

    if (descriptor.properties != null) {
      descriptor.modelProperties = [];
      for (var propertyName in descriptor.properties) {
        property = descriptor.properties[propertyName];
        descriptor.modelProperties.push(property);
      }
      descriptor.modelProperties.sort((a, b) => {
        return a.modelName < b.modelName
          ? -1
          : a.modelName > b.modelName ? 1 : 0;
      });
      if (descriptor.modelProperties.length > 0) {
        descriptor.modelProperties[
          descriptor.modelProperties.length - 1
        ].propertyIsLast = true;
      }
    }

    models[name] = descriptor;
  }

  // Now that we know all models, process the hierarchies
  for (name in models) {
    model = models[name];
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
  var addToDependencies = (t, i) => dependencies.add(t);
  for (name in models) {
    model = models[name];
    if (model.modelIsEnum || model.modelIsSimple) {
      // Enums or simple types have no dependencies
      continue;
    }
    var dependencies = new DependenciesResolver(models, model.modelName);

    // The parent is a dependency
    if (model.modelParent) {
      dependencies.add(model.modelParent.modelName);
    }

    // The subclasses are dependencies
    if (model.modelSubclasses) {
      for (i = 0; i < model.modelSubclasses.length; i++) {
        var child = model.modelSubclasses[i];
        dependencies.add(child.modelName);
      }
    }

    // Each property may add a dependency
    if (model.modelProperties) {
      for (i = 0; i < model.modelProperties.length; i++) {
        property = model.modelProperties[i];
        var type = property.propertyType;
        if (type.allTypes) {
          // This is an inline object. Append all types
          type.allTypes.forEach(addToDependencies);
        } else {
          dependencies.add(type);
        }
      }
    }

    // If an array, the element type is a dependency
    if (model.modelElementType) {
      dependencies.add(model.modelElementType);
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
  if (typeof type == 'object') {
    return 'object';
  }
  var pos = (type || '').indexOf('[');
  return pos >= 0 ? type.substr(0, pos) : type;
}

/**
 * Returns the TypeScript property type for the given raw property
 */
function propertyType(property) {
  var type;
  if (property == null) {
    return 'void';
  } else if (property.$ref != null) {
    // Type is a reference
    return simpleRef(property.$ref);
  } else if (property['x-type']) {
    // Type is read from the x-type vendor extension
    type = (property['x-type'] || '').toString().replace('List<', 'Array<');
    var pos = type.indexOf('Array<');
    if (pos >= 0) {
      type = type.substr('Array<'.length, type.length);
      type = type.substr(0, type.length - 1) + '[]';
    }
    return type.length == 0 ? 'void' : type;
  }
  switch (property.type) {
    case 'string':
      return 'string';
    case 'array':
      return propertyType(property.items) + '[]';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      var def = '{';
      var first = true;
      var allTypes = [];
      if (property.properties) {
        for (var name in property.properties) {
          var prop = property.properties[name];
          if (first) {
            first = false;
          } else {
            def += ', ';
          }
          type = propertyType(prop);
          if (allTypes.indexOf(type) < 0) {
            allTypes.push(type);
          }
          def += name + ': ' + type;
        }
      }
      if (property.additionalProperties) {
        if (!first) {
          def += ', ';
        }
        type = propertyType(property.additionalProperties);
        if (allTypes.indexOf(type) < 0) {
          allTypes.push(type);
        }
        def += '[key: string]: ' + type;
      }
      def += '}';
      return {
        allTypes: allTypes,
        toString: () => def,
      };
    default:
      return 'any';
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
      propertyName: name,
      propertyComments: toComments(property.description, 1),
      propertyRequired: requiredProperties.indexOf(name) >= 0,
      propertyType: propertyType(property),
    };
    result[name] = descriptor;
  }
  return result;
}

/**
 * Resolves a local reference in the given swagger file
 */
function resolveRef(swagger, ref) {
  if (ref.indexOf('#/') != 0) {
    console.error('Resolved references must start with #/. Current: ' + ref);
    process.exit(1);
  }
  var parts = ref.substr(2).split('/');
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
  operationResponses.returnHeaders = false;
  for (var code in responses) {
    var response = responses[code];
    if (!response.schema) {
      continue;
    }
    var type = propertyType(response.schema);
    if (/2\d\d/.test(code)) {
      // Successful response
      operationResponses.resultType = type;
      operationResponses.resultDescription = response.description;
      var headers = response.headers || {};
      for (var prop in headers) {
        // This operation returns at least one header
        operationResponses.returnHeaders = true;
        break;
      }
    }
    operationResponses[code] = {
      code: code,
      type: type,
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
  var repl = paramsClass == null ? '$${' : '$${params.';
  return (path || '').replace(/\{/g, repl);
}

/**
 * Transforms the given string into a valid identifier
 */
function toIdentifier(string) {
  var result = '';
  var wasSep = false;
  for (var i = 0; i < string.length; i++) {
    var c = string.charAt(i);
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
    tag = options.defaultTag || 'Api';
  }
  tag = toIdentifier(tag);
  return tag.charAt(0).toUpperCase() + (tag.length == 1 ? '' : tag.substr(1));
}

/**
 * Returns the actual operation id, assuming the one given.
 * If none is given, generates one
 */
function operationId(given, method, url, allKnown) {
  var id;
  var generate = given == null;
  if (generate) {
    id = toIdentifier(method + url);
  } else {
    id = given;
  }
  var duplicated = allKnown.has(id);
  if (duplicated) {
    var i = 1;
    while (allKnown.has(id + '_' + i)) {
      i++;
    }
    id = id + '_' + i;
  }
  if (generate) {
    console.warn(
      "Operation '" +
        method +
        "' on '" +
        url +
        "' defines no operationId. Assuming '" +
        id +
        "'."
    );
  } else if (duplicated) {
    console.warn(
      "Operation '" +
        method +
        "' on '" +
        url +
        "' defines a duplicated operationId: " +
        given +
        '. ' +
        "Assuming '" +
        id +
        "'."
    );
  }
  allKnown.add(id);
  return id;
}

/**
 * Process API paths, returning an object with descriptors keyed by tag name.
 * It is required that operations define a single tag, or they are ignored.
 */
function processServices(swagger, models, options) {
  var param, name, i, j;
  var services = {};
  var operationIds = new Set();
  var minParamsForContainer = options.minParamsForContainer || 2;
  for (var url in swagger.paths) {
    var path = swagger.paths[url];
    for (var method in path || {}) {
      var def = path[method];
      if (!def) {
        continue;
      }
      var tags = def.tags || [];
      var tag = tagName(tags.length == 0 ? null : tags[0], options);
      var descriptor = services[tag];
      if (descriptor == null) {
        descriptor = {
          serviceName: tag,
          serviceClass: tag + 'Service',
          serviceFile: toFileName(tag) + '.service',
          operationIds: new Set(),
          serviceOperations: [],
        };
        services[tag] = descriptor;
      }

      var id = operationId(
        def.operationId,
        method,
        url,
        descriptor.operationIds
      );

      var parameters = def.parameters || [];

      var paramsClass = null;
      var paramsClassComments = null;
      if (parameters.length >= minParamsForContainer) {
        paramsClass = id.charAt(0).toUpperCase() + id.substr(1) + 'Params';
        paramsClassComments = toComments('Parameters for ' + id, 1);
      }

      var operationParameters = [];
      for (var p = 0; p < parameters.length; p++) {
        param = parameters[p];
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
          paramName: param.name,
          paramIn: param.in,
          paramVar: paramVar,
          paramFullVar: (paramsClass == null ? '' : 'params.') + paramVar,
          paramRequired: param.required === true || param.in === 'path',
          paramIsQuery: param.in === 'query',
          paramIsPath: param.in === 'path',
          paramIsHeader: param.in === 'header',
          paramIsBody: param.in === 'body',
          paramIsArray: param.type === 'array',
          paramDescription: param.description,
          paramComments: toComments(param.description, 2),
          paramType: paramType,
          paramCollectionFormat: param.collectionFormat,
        };
        operationParameters.push(paramDescriptor);
      }
      operationParameters.sort((a, b) => {
        if (a.paramRequired && !b.paramRequired) return -1;
        if (!a.paramRequired && b.paramRequired) return 1;
        return a.paramName > b.paramName
          ? -1
          : a.paramName < b.paramName ? 1 : 0;
      });
      if (operationParameters.length > 0) {
        operationParameters[operationParameters.length - 1].paramIsLast = true;
      }
      var operationResponses = processResponses(def, path, models);
      var resultType = operationResponses.resultType;
      var docString = (def.description || '').trim();
      if (paramsClass == null) {
        for (i = 0; i < operationParameters.length; i++) {
          param = operationParameters[i];
          docString +=
            '\n@param ' + param.paramName + ' ' + param.paramDescription;
        }
      } else {
        docString +=
          '\n@param params The `' +
          descriptor.serviceClass +
          '.' +
          paramsClass +
          '` containing the following parameters:\n';
        for (i = 0; i < operationParameters.length; i++) {
          param = operationParameters[i];
          docString += '\n- `' + param.paramName + '`: ';
          var lines = (param.paramDescription || '').trim().split('\n');
          for (var l = 0; l < lines.length; l++) {
            var line = lines[l];
            if (line === '') {
              docString += '\n';
            } else {
              docString += (l == 0 ? '' : '  ') + line + '\n';
            }
          }
        }
      }
      if (operationResponses.resultDescription) {
        docString += '\n@return ' + operationResponses.resultDescription;
      }
      var operation = {
        operationName: id,
        operationParamsClass: paramsClass,
        operationParamsClassComments: paramsClassComments,
        operationMethod: method.toLocaleUpperCase(),
        operationPath: url,
        operationPathExpression: toPathExpression(paramsClass, url),
        operationResultType: resultType,
        operationComments: toComments(docString, 1),
        operationParameters: operationParameters,
        operationResponses: operationResponses,
      };
      var modelResult = models[removeBrackets(resultType)];
      var actualType = resultType;
      if (modelResult && modelResult.modelIsSimple) {
        actualType = modelResult.modelSimpleType;
        var actualModel = models[removeBrackets(actualType)];
      }
      operation.operationIsVoid = actualType === 'void';
      operation.operationIsString = actualType === 'string';
      operation.operationIsNumber = actualType === 'number';
      operation.operationIsBoolean = actualType === 'boolean';
      operation.operationIsEnum = modelResult && modelResult.modelIsEnum;
      operation.operationIsObject = modelResult && modelResult.modelIsObject;
      operation.operationIsPrimitiveArray =
        !modelResult && resultType.toString().indexOf('[]') >= 0;
      operation.operationResponseType =
        operation.operationIsVoid ||
        operation.operationIsString ||
        operation.operationIsNumber ||
        operation.operationIsBoolean ||
        operation.operationIsEnum
          ? 'text'
          : 'json';
      operation.operationIsUnknown = !(
        operation.operationIsVoid ||
        operation.operationIsString ||
        operation.operationIsNumber ||
        operation.operationIsBoolean ||
        operation.operationIsEnum ||
        operation.operationIsObject ||
        operation.operationIsPrimitiveArray
      );
      descriptor.serviceOperations.push(operation);
    }
  }

  // Read the comments of each tag to use for service comments
  if (swagger.tags && swagger.tags.length > 0) {
    for (i = 0; i < swagger.tags.length; i++) {
      const tag = swagger.tags[i];
      const name = tagName(tag.name);
      const service = services[name];
      if (service && tag.description) {
        service.serviceComments = toComments(tag.description);
      }
    }
  }

  // Resolve the models used by each
  for (name in services) {
    var service = services[name];
    var dependencies = new DependenciesResolver(models);
    for (i = 0; i < service.serviceOperations.length; i++) {
      var op = service.serviceOperations[i];
      for (var code in op.operationResponses) {
        var response = op.operationResponses[code];
        dependencies.add(response.type);
      }
      for (j = 0; j < op.operationParameters.length; j++) {
        param = op.operationParameters[j];
        dependencies.add(param.paramType);
      }
    }
    service.serviceDependencies = dependencies.get();
  }

  return services;
}

module.exports = ngSwaggerGen;
