'use strict';

/* jshint -W014 */
/* jshint -W083 */

const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');
const $RefParser = require('json-schema-ref-parser');
var npmConfig = require('npm-conf');

/**
 * Main generate function
 */
function ngSwaggerGen(options) {
  if (typeof options.swagger != 'string') {
    console.error("Swagger file not specified in the 'swagger' option");
    process.exit(1);
  }

  setupProxy();

  $RefParser.bundle(options.swagger,
    { dereference: { circular: false },
    resolve: { http: { timeout: options.timeout } } }).then(
    data => {
      doGenerate(data, options);
    },
    err => {
      console.error(
        `Error reading swagger location ${options.swagger}: ${err}`
      );
    }
  ).catch(function (error) {
    console.error(`Error: ${error}`);
  });
}

/**
 * Sets up the environment to work behind proxies.
 * Uses global-agent from NodeJS >= 10,
 * and global-tunnel-ng for previous versions.
 */
function setupProxy() {
  var globalAgent = require('global-agent');
  var globalTunnel = require('global-tunnel-ng');
  var proxyAddress = getProxyAndSetupEnv();

  const NODEJS_VERSION = parseInt(process.version.slice(1).split('.')[0], 10);
  if (NODEJS_VERSION >= 10 && proxyAddress) {
    // `global-agent` works with Node.js v10 and above.
    globalAgent.bootstrap();
    global.GLOBAL_AGENT.HTTP_PROXY = proxyAddress;
  } else {
    // `global-tunnel-ng` works only with Node.js v10 and below.
    globalTunnel.initialize();
  }
}

/**
 * For full compatibility with globalTunnel we need to check a few places for
 * the correct proxy address. Additionally we need to remove HTTP_PROXY
 * and HTTPS_PROXY environment variables, if present.
 * This is again for globalTunnel compatibility.
 *
 * This method only needs to be run when global-agent is used
 */
function getProxyAndSetupEnv() {
  var proxyEnvVariableNames = [
    'https_proxy',
    'HTTPS_PROXY',
    'http_proxy',
    'HTTP_PROXY'
  ];

  var npmVariableNames = ['https-proxy', 'http-proxy', 'proxy'];

  var key;
  var val;
  var result;
  for (var i = 0; i < proxyEnvVariableNames.length; i++) {
    key = proxyEnvVariableNames[i];
    val = process.env[key];
    if (val) {
      // Get the first non-empty
      result = result || val;
      // Delete all
      // NB: we do it here to prevent double proxy handling
      // (and for example path change)
      // by us and the `request` module or other sub-dependencies
      delete process.env[key];
    }
  }

  if (!result) {
    var config = npmConfig();

    for (i = 0; i < npmVariableNames.length && !result; i++) {
      result = config.get(npmVariableNames[i]);
    }
  }

  return result;
}

/**
 * Proceeds with the generation given the parsed swagger object
 */
function doGenerate(swagger, options) {
  if (!options.templates) {
    options.templates = path.join(__dirname, 'templates');
  }

  var output = path.normalize(options.output || 'src/app/api');
  var prefix = options.prefix || 'Api';

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

  // read the fallback templates
  var fallbackTemplates = path.join(__dirname, 'templates');
  fs.readdirSync(fallbackTemplates)
    .forEach(function (file) {
    var pos = file.indexOf('.mustache');
    if (pos >= 0) {
      var fullFile = path.join(fallbackTemplates, file);
      if (!(file.substr(0, pos) in templates)) {
        templates[file.substr(0, pos)] = fs.readFileSync(fullFile, 'utf-8');
      }
    }
  });

  // Prepare the output folder
  const modelsOutput = path.join(output, 'models');
  const servicesOutput = path.join(output, 'services');
  mkdirs(modelsOutput);
  mkdirs(servicesOutput);

  var removeStaleFiles = options.removeStaleFiles !== false;
  var generateEnumModule = options.enumModule !== false;

  // Utility function to render a template and write it to a file
  var generate = function(template, model, file) {
    var code = Mustache.render(template, model, templates)
      .replace(/[^\S\r\n]+$/gm, '');
    fs.writeFileSync(file, code, 'UTF-8');
    console.info('Wrote ' + file);
  };

  // Calculate the globally used names
  var moduleClass = toClassName(prefix + 'Module');
  var moduleFile = toFileName(moduleClass);
  // Angular's best practices demands xxx.module.ts, not xxx-module.ts
  moduleFile = moduleFile.replace(/\-module$/, '.module');
  var configurationClass = toClassName(prefix + 'Configuration');
  var configurationInterface = toClassName(prefix + 'ConfigurationInterface');
  var configurationFile = toFileName(configurationClass);

  function applyGlobals(to) {
    to.prefix = prefix;
    to.moduleClass = moduleClass;
    to.moduleFile = moduleFile;
    to.configurationClass = configurationClass;
    to.configurationInterface = configurationInterface;
    to.configurationFile = configurationFile;
    return to;
  }

  // Write the models and examples
  var modelsArray = [];
  for (var modelName in models) {
    var model = models[normalizeModelName(modelName)];
    if (model.modelIsEnum) {
      model.enumModule = generateEnumModule;
    }
    applyGlobals(model);

    // When the model name differs from the class name, it will be duplicated
    // in the array. For example the-user would be TheUser, and would be twice.
    if (modelsArray.includes(model)) {
      continue;
    }
    modelsArray.push(model);
    generate(
      templates.model,
      model,
      path.join(modelsOutput, model.modelFile + '.ts')
    );
    if (options.generateExamples && model.modelExample) {
      var value = resolveRefRecursive(model.modelExample, swagger);
      var example = JSON.stringify(value, null, 2);
      example = example.replace(/'/g, "\\'");
      example = example.replace(/"/g, "'");
      example = example.replace(/\n/g, "\n  ");
      model.modelExampleStr = example;
      generate(
        templates.example,
        model,
        path.join(modelsOutput, model.modelExampleFile + '.ts')
      );
    }
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
        var model = models[normalizeModelName(modelName)];
        if (basename == model.modelFile + '.ts'
          || basename == model.modelExampleFile + '.ts'
            && model.modelExampleStr != null) {
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
  var modelIndexFile = path.join(output, 'models.ts');
  if (options.modelIndex !== false) {
    generate(templates.models, { models: modelsArray }, modelIndexFile);
  } else if (removeStaleFiles) {
    rmIfExists(modelIndexFile);
  }

  // Write the StrictHttpResponse type
  generate(templates.strictHttpResponse, {},
    path.join(output, 'strict-http-response.ts'));

  // Write the services
  var servicesArray = [];
  for (var serviceName in services) {
    var service = services[serviceName];
    service.generalErrorHandler = options.errorHandler !== false;
    applyGlobals(service);
    servicesArray.push(service);

    generate(
      templates.service,
      service,
      path.join(servicesOutput, service.serviceFile + '.ts')
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
  var serviceIndexFile = path.join(output, 'services.ts');
  if (options.serviceIndex !== false) {
    generate(templates.services, { services: servicesArray }, serviceIndexFile);
  } else if (removeStaleFiles) {
    rmIfExists(serviceIndexFile);
  }

  // Write the module
  var fullModuleFile = path.join(output, moduleFile + '.ts');
  if (options.apiModule !== false) {
    generate(templates.module, applyGlobals({
        services: servicesArray
      }),
      fullModuleFile);
  } else if (removeStaleFiles) {
    rmIfExists(fullModuleFile);
  }

  // Write the configuration
  {
    var rootUrl = '';
    if (swagger.hasOwnProperty('host') && swagger.host !== '') {
      var schemes = swagger.schemes || [];
      var scheme = schemes.length === 0 ? '//' : schemes[0] + '://';
      rootUrl = scheme + swagger.host;
    }
    if (swagger.hasOwnProperty('basePath') && swagger.basePath !== ''
      && swagger.basePath !== '/') {
      rootUrl += swagger.basePath;
    }

    generate(templates.configuration, applyGlobals({
        rootUrl: rootUrl,
      }),
      path.join(output, configurationFile + '.ts')
    );
  }

  // Write the BaseService
  {
    generate(templates.baseService, applyGlobals({}),
      path.join(output, 'base-service.ts'));
  }
}

function normalizeModelName(name) {
  return name.toLowerCase();
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
  const addToUsed = (dep) => usedModels.add(dep);
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
      service.serviceErrorDependencies.forEach(addToUsed);
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
      var model = models[normalizeModelName(modelName)];
      if (!allDependencies.has(model.modelClass)) {
        // This model is not used - remove it
        console.info(
          'Ignoring model ' +
            modelName +
            ' because it was not used by any service'
        );
        delete models[normalizeModelName(modelName)];
      }
    }
  }
}

/**
 * Collects on the given dependencies set all dependencies of the given model
 */
function collectDependencies(dependencies, model, models) {
  if (!model || dependencies.has(model.modelClass)) {
    return;
  }
  dependencies.add(model.modelClass);
  if (model.modelDependencies) {
    model.modelDependencies.forEach((dep) =>
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
 * Converts a given name into a valid class name
 */
function toClassName(name) {
  var result = '';
  var upNext = false;
  for (var i = 0; i < name.length; i++) {
    var c = name.charAt(i);
    var valid = /[\w]/.test(c);
    if (!valid) {
      upNext = true;
    } else if (upNext) {
      result += c.toUpperCase();
      upNext = false;
    } else if (result === '') {
      result = c.toUpperCase();
    } else {
      result += c;
    }
  }
  if (/[0-9]/.test(result.charAt(0))) {
    result = '_' + result;
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
    ref = ref.substr(index + 1);
  }
  return toClassName(ref);
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
  if (!isNaN(value[0])) {
    result = '_' + result;
  }
  result = result.replace(/[^\w]/g, '_');
  result = result.replace(/_+/g, '_');
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
  var result = '\n' + indent + '/**\n';
  lines.forEach(line => {
    result += indent + ' *' + (line === '' ? '' : ' ' + line) + '\n';
  });
  result += indent + ' */\n' + indent;
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
DependenciesResolver.prototype.add = function(input) {
  let deps;
  if (input.allTypes) {
    deps = input.allTypes;
  } else {
    deps = [removeBrackets(input)];
  }
  for (let i = 0; i < deps.length; i++) {
    let dep = deps[i];
    if (this.dependencyNames.indexOf(dep) < 0 && dep !== this.ownType) {
      var depModel = this.models[normalizeModelName(dep)];
      if (depModel) {
        this.dependencies.push(depModel);
        this.dependencyNames.push(depModel.modelClass);
      }
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
    var parents = null;
    var properties = null;
    var requiredProperties = null;
    var additionalPropertiesType = false;
    var example = model.example || null;
    var enumValues = null;
    var elementType = null;
    var simpleType = null;
    if (model.allOf != null && model.allOf.length > 0) {
      parents = model.allOf
        .filter(parent => !!parent.$ref)
        .map(parent => simpleRef(parent.$ref));
      properties = (model.allOf.find(val => !!val.properties) || {}).properties || {};
      requiredProperties = (model.allOf.find(val => !!val.required) || {}).required || [];
      enumValues = model.enum || [];
      if (parents && parents.length) {
        simpleType = null;
        enumValues = null;
      } else if (enumValues.length == 0) {
        simpleType = 'string';
        enumValues = null;
      } else {
        for (i = 0; i < enumValues.length; i++) {
          var enumValue = enumValues[i];
          var enumDescriptor = {
            enumName: toEnumName(enumValue),
            enumValue: String(enumValue).replace(/\'/g, '\\\''),
            enumIsLast: i === enumValues.length - 1,
          };
          enumValues[i] = enumDescriptor;
        }
      }
    } else if (model.type === 'array') {
      elementType = propertyType(model);
    } else if (!model.type && (model.anyOf || model.oneOf)) {
      let of = model.anyOf || model.oneOf;
      let variants = of.map(propertyType);
      simpleType = {
        allTypes: mergeTypes(...variants),
        toString: () => variants.join(' |\n  ')
      };
    } else if (model.type === 'object' || model.type === undefined) {
      properties = model.properties || {};
      requiredProperties = model.required || [];
      additionalPropertiesType = model.additionalProperties &&
          (typeof model.additionalProperties === 'object' ? propertyType(model.additionalProperties) : 'any');
    } else {
      simpleType = propertyType(model);
    }
    var modelClass = toClassName(name);
    var descriptor = {
      modelName: name,
      modelClass: modelClass,
      modelFile: toFileName(modelClass) + options.customFileSuffix.model,
      modelComments: toComments(model.description),
      modelParents: parents,
      modelIsObject: properties != null,
      modelIsEnum: enumValues != null,
      modelIsArray: elementType != null,
      modelIsSimple: simpleType != null,
      modelSimpleType: simpleType,
      properties: properties == null ? null :
        processProperties(swagger, properties, requiredProperties),
      modelExample: example,
      modelAdditionalPropertiesType: additionalPropertiesType,
      modelExampleFile: toFileName(name) + options.customFileSuffix.example,
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
        return a.propertyName < b.propertyName ? -1 :
          a.propertyName > b.propertyName ? 1 : 0;
      });
      if (descriptor.modelProperties.length > 0) {
        descriptor.modelProperties[
          descriptor.modelProperties.length - 1
        ].propertyIsLast = true;
      }
    }

    models[normalizeModelName(name)] = descriptor;
    models[normalizeModelName(descriptor.modelClass)] = descriptor;
  }

  // Now that we know all models, process the hierarchies
  for (name in models) {
    model = models[normalizeModelName(name)];
    if (!model.modelIsObject) {
      // Only objects can have hierarchies
      continue;
    }

    // Process the hierarchy
    var parents = model.modelParents;
    if (parents && parents.length > 0) {
      model.modelParents = parents
        .filter(parentName => !!parentName)
        .map(parentName => {
        // Make the parent be the actual model, not the name
        var parentModel =  models[normalizeModelName(parentName)];

        // Append this model on the parent's subclasses
        parentModel.modelSubclasses.push(model);
        return parentModel;
        });
      model.modelParentNames = model.modelParents.map(
        (parent, index) => ({
          modelClass: parent.modelClass,
          parentIsFirst: index === 0,
        })
      );
    }
  }

  // Now that the model hierarchy is ok, resolve the dependencies
  var addToDependencies = t => {
    if (Array.isArray(t.allTypes)) {
      t.allTypes.forEach(it => dependencies.add(it));
    }
    else dependencies.add(t);
  };
  for (name in models) {
    model = models[normalizeModelName(name)];
    if (model.modelIsEnum || model.modelIsSimple && !model.modelSimpleType.allTypes) {
      // Enums or simple types have no dependencies
      continue;
    }
    var dependencies = new DependenciesResolver(models, model.modelName);

    // The parent is a dependency
    if (model.modelParents) {
      model.modelParents.forEach(modelParent => {
        dependencies.add(modelParent.modelName);
      })
    }

    // Each property may add a dependency
    if (model.modelProperties) {
      for (i = 0; i < model.modelProperties.length; i++) {
        property = model.modelProperties[i];
        addToDependencies(property.propertyType);
      }
    }

    // If an array, the element type is a dependency
    if (model.modelElementType) addToDependencies(model.modelElementType);

    if (model.modelSimpleType) addToDependencies(model.modelSimpleType);

    if (model.modelAdditionalPropertiesType) addToDependencies(model.modelAdditionalPropertiesType);

    model.modelDependencies = dependencies.get();
  }

  return models;
}

/**
 * Removes an array designation from the given type.
 * For example, "Array<a>" returns "a", "a[]" returns "a", while "b" returns "b".
 * A special case is for inline objects. In this case, the result is "object".
 */
function removeBrackets(type, nullOrUndefinedOnly) {
  if(typeof nullOrUndefinedOnly === "undefined") {
    nullOrUndefinedOnly = false;
  }
  if (typeof type === 'object') {
    if (type.allTypes && type.allTypes.length === 1) {
      return removeBrackets(type.allTypes[0], nullOrUndefinedOnly);
    }
    return 'object';
  }
  else if(type.replace(/ /g, '') !== type) {
    return removeBrackets(type.replace(/ /g, ''));
  }
  else if(type.indexOf('null|') === 0) {
    return removeBrackets(type.substr('null|'.length));
  }
  else if(type.indexOf('undefined|') === 0) {
    // Not used currently, but robust code is better code :)
    return removeBrackets(type.substr('undefined|'.length));
  }
  if (type == null || type.length === 0 || nullOrUndefinedOnly) {
    return type;
  }
  var pos = type.indexOf('Array<');
  if (pos >= 0) {
    var start = 'Array<'.length;
    return type.substr(start, type.length - start - 1);
  }
  pos = type.indexOf('[');
  return pos >= 0 ? type.substr(0, pos) : type;
}

/**
 * Combine dependencies of multiple types.
 * @param types
 * @return {Array}
 */
function mergeTypes(...types) {
  let allTypes = [];
  types.forEach(type => {
    (type.allTypes || [type]).forEach(type => {
      if (allTypes.indexOf(type) < 0) allTypes.push(type);
    });
  });
  return allTypes;
}

/**
 * Returns the TypeScript property type for the given raw property
 */
function propertyType(property) {
  var type;
  if (property === null || property.type === null) {
    return 'null';
  } else if (property.$ref != null) {
    // Type is a reference
    return simpleRef(property.$ref);
  } else if (property['x-type']) {
    // Type is read from the x-type vendor extension
    type = (property['x-type'] || '').toString().replace('List<', 'Array<');
    return type.length == 0 ? 'null' : type;
  } else if (property['x-nullable']) {
    return 'null | ' + propertyType(
      Object.assign(property, {'x-nullable': undefined}));
  } else if (!property.type && (property.anyOf || property.oneOf)) {
    let variants = (property.anyOf || property.oneOf).map(propertyType);
    return {
      allTypes: mergeTypes(...variants),
      toString: () => variants.join(' | ')
    };
  } else if (!property.type && property.allOf) {
    // Do not want to include x-nullable types as part of an allOf union.
    let variants = (property.allOf).filter(prop => !prop['x-nullable']).map(propertyType);

    return {
      allTypes: mergeTypes(...variants),
      toString: () => variants.join(' & ')
    };
  } else if (Array.isArray(property.type)) {
    let variants = property.type.map(type => propertyType(Object.assign({}, property, {type})));
    return {
      allTypes: mergeTypes(...variants),
      toString: () => variants.join(' | ')
    };
  }
  switch (property.type) {
    case 'null':
      return 'null';
    case 'string':
      if (property.enum && property.enum.length > 0) {
        return '\'' + property.enum.join('\' | \'') + '\'';
      }
      else if (property.const) {
        return '\'' + property.const + '\'';
      }
      return 'string';
    case 'array':
      if (Array.isArray(property.items)) { // support for tuples
        if (!property.maxItems) return 'Array<any>'; // there is unable to define unlimited tuple in TypeScript
        let minItems = property.minItems || 0,
            maxItems = property.maxItems,
            types = property.items.map(propertyType);
        types.push(property.additionalItems ? propertyType(property.additionalItems) : 'any');
        let variants = [];
        for (let i = minItems; i <= maxItems; i++) variants.push(types.slice(0, i));
        return {
          allTypes: mergeTypes(...types.slice(0, maxItems)),
          toString: () => variants.map(types => `[${types.join(', ')}]`).join(' | ')
        };
      }
      else {
        let itemType = propertyType(property.items);
        return {
          allTypes: mergeTypes(itemType),
          toString: () => 'Array<' + itemType + '>'
        };
      }
    case 'integer':
    case 'number':
      if (property.enum && property.enum.length > 0) return property.enum.join(' | ');
      if (property.const) return property.const;
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'file':
      return 'Blob';
    case 'object':
      var def = '{';
      let memberCount = 0;
      var allTypes = [];
      if (property.properties) {
        for (var name in property.properties) {
          var prop = property.properties[name];
          if (memberCount++) def += ', ';
          type = propertyType(prop);
          allTypes.push(type);
	        let required = property.required && property.required.indexOf(name) >= 0;
	        def += name + (required ? ': ' : '?: ') + type;
        }
      }
      if (property.additionalProperties) {
        if (memberCount++) def += ', ';
        type = typeof property.additionalProperties === 'object' ?
            propertyType(property.additionalProperties) : 'any';
	      allTypes.push(type);
        def += '[key: string]: ' + type;
      }
      def += '}';

      return {
        allTypes: mergeTypes(...allTypes),
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
      propertyName: name.indexOf('-') === -1 && name.indexOf(".") === -1 ? name : `"${name}"`,
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
function processResponses(swagger, def, path, models) {
  var responses = def.responses || {};
  var operationResponses = {};
  operationResponses.returnHeaders = false;
  for (var code in responses) {
    var response = responses[code];
    if (response.$ref) {
      response = resolveRef(swagger, response.$ref);
    }
    if (!response.schema) {
      continue;
    }
    var type = propertyType(response.schema);
    if (/2\d\d/.test(code)) {
      // Successful response
      if (operationResponses.resultType) {
        // More than one successful response, use union type
        operationResponses.resultType += ` | ${type}`;
        operationResponses.resultDescription += ` or ${response.description}`
      } else {
        operationResponses.resultType = type;
        operationResponses.resultDescription = response.description;
      }
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
    operationResponses.resultType = 'null';
  }
  return operationResponses;
}

/**
 * Returns a path expression to be evaluated, for example:
 * "/a/{var1}/b/{var2}/" returns "/a/${params.var1}/b/${params.var2}"
 * if there is a parameters class, or "/a/${var1}/b/${var2}" otherwise.
 */
function toPathExpression(operationParameters, paramsClass, path) {
  return (path || '').replace(/\{([^}]+)}/g, (_, pName) => {
    const param = operationParameters.find(p => p.paramName === pName);
    const paramName = param ? param.paramVar : pName;
    return paramsClass ?
      "${encodeURIComponent(params." + paramName + ")}" :
      "${encodeURIComponent(" + paramName + ")}";
  });
}

/**
 * Transforms the given string into a valid identifier
 */
function toIdentifier(string) {
  var result = '';
  var wasSep = false;
  for (var i = 0; i < string.length; i++) {
    var c = string.charAt(i);
    if (/[a-zA-Z0-9]/.test(c)) {
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
    id = toIdentifier(given);
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
  var minParamsForContainer = options.minParamsForContainer || 2;
  var sortParams = options.sortParams || 'desc';
  for (var url in swagger.paths) {
    var path = swagger.paths[url];
	  var methodParameters = path.parameters;
    for (var method in path || {}) {
      var def = path[method];
      if (!def || method == 'parameters') {
        continue;
      }
      var tags = def.tags || [];
      var tag = tagName(tags.length == 0 ? null : tags[0], options);
      var descriptor = services[tag];
      if (descriptor == null) {
        var serviceClass = toClassName(tag);
        descriptor = {
          serviceName: tag,
          serviceClass: serviceClass + 'Service',
          serviceFile: toFileName(serviceClass) + options.customFileSuffix.service,
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

      if (methodParameters) {
        parameters = parameters.concat(methodParameters);
      }

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
        var paramTypeNoNull = removeBrackets(paramType, true);
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
          paramIsFormData: param.in === 'formData',
          paramIsArray: param.type === 'array',
          paramToJson: param.in === 'formData' && !param.enum && paramTypeNoNull !== 'Blob' &&
            paramTypeNoNull !== 'string',
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
        switch (sortParams) {
          case 'asc':
            return a.paramName > b.paramName ? 1 :
              a.paramName < b.paramName ? -1 : 0;
          case 'desc':
            return a.paramName > b.paramName ? -1 :
              a.paramName < b.paramName ? 1 : 0;
          default:
            return 0;
        }
      });
      if (operationParameters.length > 0) {
        operationParameters[operationParameters.length - 1].paramIsLast = true;
      }
      var operationResponses = processResponses(swagger, def, path, models);
      var resultType = operationResponses.resultType;
      var isMultipart = false;
      for (i = 0; i < operationParameters.length; i++) {
        if (operationParameters[i].paramIsFormData) {
          isMultipart = true;
          break;
        }
      }
      var docString = (def.description || '').trim();
      var summary = (def.summary || path.summary || '').trim();
      if (summary !== '') {
        if (docString === '') {
          docString = summary;
        } else {
          docString = summary + '\n\n' + docString;
        }
      }
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
      function getOperationName(string) {
        if (options.camelCase) return string.charAt(0).toLowerCase() + string.slice(1);
        else return string;
      }
      var operation = {
        operationName: getOperationName(id),
        operationParamsClass: paramsClass,
        operationParamsClassComments: paramsClassComments,
        operationMethod: method.toLocaleUpperCase(),
        operationPath: url.replace(/\'/g, '\\\''),
        operationPathExpression:
          toPathExpression(operationParameters, paramsClass, url),
        operationResultType: resultType,
        operationHttpResponseType: '__StrictHttpResponse<' + resultType + '>',
        operationComments: toComments(docString, 1),
        operationParameters: operationParameters,
        operationResponses: operationResponses,
      };
      var modelResult = models[normalizeModelName(removeBrackets(resultType))];
      var actualType = resultType;
      if (modelResult && modelResult.modelIsSimple) {
        actualType = modelResult.modelSimpleType;
      }
      operation.operationIsMultipart = isMultipart;
      operation.operationIsVoid = actualType === 'void';
      operation.operationIsString = actualType === 'string';
      operation.operationIsNumber = actualType === 'number';
      operation.operationIsOther =
        !['void', 'number', 'boolean'].includes(actualType);
      operation.operationIsBoolean = actualType === 'boolean';
      operation.operationIsEnum = modelResult && modelResult.modelIsEnum;
      operation.operationIsObject = modelResult && modelResult.modelIsObject;
      operation.operationIsPrimitiveArray =
        !modelResult && (resultType.toString().includes('Array<') ||
          resultType.toString().includes('[]'));
      operation.operationIsFile = actualType === 'Blob';
      operation.operationResponseType =
        operation.operationIsFile ? 'blob' :
        operation.operationIsVoid ||
        operation.operationIsString ||
        operation.operationIsNumber ||
        operation.operationIsBoolean ||
        operation.operationIsEnum ?
          'text' : 'json';
      operation.operationIsUnknown = !(
        operation.operationIsVoid ||
        operation.operationIsString ||
        operation.operationIsNumber ||
        operation.operationIsBoolean ||
        operation.operationIsEnum ||
        operation.operationIsObject ||
        operation.operationIsFile ||
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

  // Resolve the models used by each service
  for (name in services) {
    var service = services[name];
    var dependencies = new DependenciesResolver(models);
    var errorDependencies = new DependenciesResolver(models);
    for (i = 0; i < service.serviceOperations.length; i++) {
      var op = service.serviceOperations[i];
      for (var code in op.operationResponses) {
        var status = Number(code);
        if (!isNaN(status)) {
          var actualDeps = (status < 200 || status >= 300)
            ? errorDependencies : dependencies;
          var response = op.operationResponses[code];
          if (response && response.type) {
            var type = response.type;
            if (type && type.allTypes) {
              // This is an inline object. Append all types
              type.allTypes.forEach(t => actualDeps.add(t));
            } else {
              actualDeps.add(type);
            }
          }
        }
      }
      for (j = 0; j < op.operationParameters.length; j++) {
        param = op.operationParameters[j];
        dependencies.add(param.paramType);
      }
    }
    service.serviceDependencies = dependencies.get();
    service.serviceErrorDependencies = errorDependencies.get();
  }

  return services;
}

/**
 * Processes all $ref objects recursively
 *
 * @param array Array to be searched for $ref
 * @param swagger Full Swagger Config
 * @return {*}
 */
function resolveRefRecursive(array, swagger) {

  if (!array || typeof array !== 'object') {
    return array;
  }

  if (typeof array["$ref"] === "string") {
    return resolveRefRecursive(resolveRef(swagger, array["$ref"]), swagger);
  }

  for (var key in array) {
    var funcArgs = [array[key], swagger]
    array[key] = resolveRefRecursive.apply(null, funcArgs);
  }

  return array;
}

module.exports = ngSwaggerGen;
