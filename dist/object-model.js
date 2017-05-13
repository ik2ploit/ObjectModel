(function (exports) {
'use strict';

const defineProperty = Object.defineProperty;

function is(Constructor, obj){
	return obj instanceof Constructor
}

function isFunction(o){
	return typeof o === "function"
}

function isObject(o){
    return typeof o === "object"
}

function isPlainObject(o){
	return o && isObject(o) && Object.getPrototypeOf(o) === Object.prototype
}

function bettertypeof(obj){
	return ({}).toString.call(obj).match(/\s([a-zA-Z]+)/)[1]
}

function merge(target, src={}, deep, includingProto) {
	for(let key in src){
		if(includingProto || src.hasOwnProperty(key)){
			if(deep && isPlainObject(src[key])){
				const o = {};
				merge(o, target[key], deep);
				merge(o, src[key], deep);
				target[key] = o;
			} else {
				target[key] = src[key];
			}
		}
	}
}

function define(obj, key, value, enumerable=false) {
	defineProperty(obj, key, { value, enumerable, writable: true, configurable: true });
}

function setConstructor(model, constructor){
	Object.setPrototypeOf(model, constructor.prototype);
	define(model, "constructor", constructor);
}

function setConstructorProto(constructor, proto){
	constructor.prototype = Object.create(proto);
	constructor.prototype.constructor = constructor;
}

function toString(obj, stack = []){
	if(stack.length > 15 || stack.includes(obj)) return '...'
	if(obj === null || obj === undefined) return String(obj)
	if(typeof obj === "string") return `"${obj}"`
	if(is(BasicModel, obj)) return obj.toString(stack)
	stack = [obj].concat(stack);
	if(isFunction(obj)) return obj.name || obj.toString(stack)
	if(is(Array, obj)) return `[${obj.map(item => toString(item, stack)).join(', ')}]`
	if(obj.toString !== Object.prototype.toString) return obj.toString()
	if(obj && isObject(obj)) {
		const props = Object.keys(obj),
			  indent = '\t'.repeat(stack.length);
		return `{${props.map(
			key => `\n${indent+key}: ${toString(obj[key], stack)}`
		).join(',')} ${props.length ? `\n${indent.slice(1)}` : ''}}`
	}
	return String(obj)
}

function checkDefinition(obj, def, path, errorStack, callStack, shouldCast=false){
	const indexFound = callStack.indexOf(def);
	if(indexFound !== -1 && callStack.indexOf(def, indexFound+1) !== -1)
		return obj //if found twice in call stack, cycle detected, skip validation

	if(shouldCast)
		obj = cast(obj, def);


	if(is(BasicModel, def)){
		def._validate(obj, path, errorStack, callStack.concat(def));
	}
	else if(isPlainObject(def)){
		Object.keys(def).forEach(key => {
			const val = obj != null ? obj[key] : undefined;
			checkDefinition(val, def[key], path ? path + '.' + key : key, errorStack, callStack);
		});
	}
	else {
		const pdef = parseDefinition(def);
		if(pdef.some(part => checkDefinitionPart(obj, part, path, callStack)))
			return obj

		errorStack.push({
			expected: def,
			received: obj,
			path
		});
	}

	return obj
}

function checkDefinitionPart(obj, def, path, callStack){
	if(obj == null) return obj === def
	if(isPlainObject(def) || is(BasicModel, def)){ // object or model as part of union type
		const errorStack = [];
		checkDefinition(obj, def, path, errorStack, callStack);
		return !errorStack.length
	}
	if(is(RegExp, def)) return def.test(obj)
	if(def === Number || def === Date) return obj.constructor === def && !isNaN(obj)
	return obj === def
		|| (isFunction(def) && is(def, obj))
		|| obj.constructor === def
}


function checkAssertions(obj, model, path, errorStack = model.errorStack){
	for(let assertion of model.assertions){
		let result;
		try {
			result = assertion.call(model, obj);
		} catch(err){
			result = err;
		}
		if(result !== true){
			const onFail = isFunction(assertion.description) ? assertion.description : (assertionResult, value) =>
				`assertion "${assertion.description}" returned ${toString(assertionResult)} for value ${toString(value)}`;
			errorStack.push({
				message: onFail.call(model, result, obj),
				expected: assertion,
				received: obj,
				path
			});
		}
	}
}

function cast(obj, defNode=[]) {
	if(!obj || isPlainObject(defNode) || is(BasicModel, obj.constructor))
		return obj // no value or not leaf or already a model instance

	const def = parseDefinition(defNode),
	      suitableModels = [];

	for (let part of def) {
		if(is(BasicModel, part) && part.test(obj))
			suitableModels.push(part);
	}

	if (suitableModels.length === 1)
		return suitableModels[0](obj) // automatically cast to suitable model when explicit

	if (suitableModels.length > 1)
		console.warn(`Ambiguous model for value ${toString(obj)}, could be ${suitableModels.join(" or ")}`);

	return obj
}

function BasicModel(def){
	const model = function(val = model.default) {
		model.validate(val);
		return val
	};

	initModel(model, arguments, BasicModel);
	return model
}

Object.assign(BasicModel.prototype, {
	toString(stack){
		return parseDefinition(this.definition).map(d => toString(d, stack)).join(" or ")
	},

	assertions: [],

	validate(obj, errorCollector){
		this._validate(obj, null, this.errorStack, []);
		this.unstackErrors(errorCollector);
	},

	test(obj){
		let failed,
		    initialErrorCollector = this.errorCollector;
		this.errorCollector = () => { failed = true; };
		this(obj);
		this.errorCollector = initialErrorCollector;
		return !failed
	},

	extend(){
		const args = [...arguments];
		const def = args
			.reduce((def, ext) => def.concat(parseDefinition(ext)), parseDefinition(this.definition))
			.filter((value, index, self) => self.indexOf(value) === index); // remove duplicates

		let assertions = [...this.assertions];
		args.forEach(arg => {
			if(is(BasicModel, arg)) assertions = assertions.concat(arg.assertions);
		});

		const submodel = new this.constructor(def);
		setConstructorProto(submodel, this.prototype);
		submodel.assertions = assertions;
		submodel.errorCollector = this.errorCollector;
		return submodel
	},

	assert(assertion, description = toString(assertion)){
		define(assertion, "description", description);
		this.assertions = this.assertions.concat(assertion);
		return this
	},

	defaultTo(val){
		this.default = val;
		return this
	},

	errorCollector(errors){
		let e = new TypeError(errors.map(e => e.message).join('\n'));
		e.stack = e.stack.replace(/\n.*object-model(.|\n)*object-model.*/, ""); // blackbox objectmodel in stacktrace
		throw e
	},

	_validate(obj, path, errorStack, callStack){
		checkDefinition(obj, this.definition, path, errorStack, callStack);
		checkAssertions(obj, this, path, errorStack);
	},

	// throw all errors collected
	unstackErrors(errorCollector){
		if (!this.errorStack.length) return
		if (!errorCollector) errorCollector = this.errorCollector;
		const errors = this.errorStack.map(err => {
			if (!err.message) {
				const def = is(Array, err.expected) ? err.expected : [err.expected];
				err.message = ("expecting " + (err.path ? err.path + " to be " : "") + def.map(d => toString(d)).join(" or ")
				+ ", got " + (err.received != null ? bettertypeof(err.received) + " " : "") + toString(err.received));
			}
			return err
		});
		this.errorStack = [];
		errorCollector.call(this, errors);
	}

});

BasicModel.prototype.conventionForConstant = key => key.toUpperCase() === key;
BasicModel.prototype.conventionForPrivate = key => key[0] === "_";

function initModel(model, args, constructor){
	if(args.length === 0) throw new Error("Model definition is required");
	setConstructor(model, constructor);
	model.definition = args[0];
	model.assertions = model.assertions.slice();
	define(model, "errorStack", []);
}

function parseDefinition(def){
	if(!isPlainObject(def)){
		if(!is(Array, def)) return [def]
		if(def.length === 1) return [...def, undefined, null]
	} else {
		for(let key of Object.keys(def))
			def[key] = parseDefinition(def[key]);
	}
	return def
}

function ObjectModel(def){
	const model = function(obj = model.default) {
		if(!is(model, this)) return new model(obj)
		if(is(model, obj)) return obj
		merge(this, obj, true);
		model.validate(this);
		return getProxy(model, this, model.definition)
	};

	setConstructorProto(model, Object.prototype);
	initModel(model, arguments, ObjectModel);
	return model
}

setConstructorProto(ObjectModel, BasicModel.prototype);

Object.assign(ObjectModel.prototype, {

	defaults(p){
		Object.assign(this.prototype, p);
		return this
	},

	toString(stack){
		return toString(this.definition, stack)
	},

	extend(){
		const def = {};
		const proto = {};
		const args = [...arguments];

		Object.assign(def, this.definition);
		merge(proto, this.prototype, false, true);
		args.forEach(arg => {
			if(is(BasicModel, arg)) merge(def, arg.definition, true);
			if(isFunction(arg)) merge(proto, arg.prototype, true, true);
			if(isObject(arg)) merge(def, arg, true, true);
		});
		delete proto.constructor;

		let assertions = [...this.assertions];
		args.forEach(arg => {
			if(is(BasicModel, arg)) assertions = assertions.concat(arg.assertions);
		});

		const submodel = new this.constructor(def);
		setConstructorProto(submodel, this.prototype);
		Object.assign(submodel.prototype, proto);
		submodel.assertions = assertions;
		submodel.errorCollector = this.errorCollector;
		return submodel
	},

	_validate(obj, path, errorStack, callStack){
		if(!isObject(obj)){
			errorStack.push({
				expected: this,
				received: obj,
				path
			});
		} else {
			checkDefinition(obj, this.definition, path, errorStack, callStack);
		}
		checkAssertions(obj, this, path, errorStack);
	}
});

function getProxy(model, obj, def, path) {
	if(!isPlainObject(def)) {
		return cast(obj, def)
	}

	return new Proxy(obj || {}, {
		get(o, key) {
			const newPath = (path ? path + '.' + key : key),
			      defPart = def[key];

			if(key in def && model.conventionForPrivate(key)){
				model.errorStack.push({
					message: `cannot access to private property ${newPath}`
				});
				model.unstackErrors();
				return
			}

			if(o[key] && o.hasOwnProperty(key) && !isPlainObject(defPart) && !is(BasicModel, o[key].constructor)){
				o[key] = cast(o[key], defPart); // cast nested models
			}

			if (isFunction(o[key]) && o[key].bind) {
				return o[key].bind(o); // auto-bind methods to original object, so they can access private props
			}

			return getProxy(model, o[key], defPart, newPath)
		},

		set(o, key, val) {
			return controlMutation(model, def, path, o, key, (newPath) => {
				Reflect.set(o, key, getProxy(model, val, def[key], newPath));
			})
		},

		deleteProperty(o, key) {
			return controlMutation(model, def, path, o, key, () => Reflect.deleteProperty(o, key))
		},

		defineProperty(o, key, args){
			return controlMutation(model, def, path, o, key, () => Reflect.defineProperty(o, key, args))
		},

		has(o, key){
			return Reflect.has(o, key) && Reflect.has(def, key) && !model.conventionForPrivate(key)
		},

		ownKeys(o){
			return Reflect.ownKeys(o).filter(key => Reflect.has(def, key) && !model.conventionForPrivate(key))
		},

		getOwnPropertyDescriptor(o, key){
			return model.conventionForPrivate(key) ? undefined : Reflect.getOwnPropertyDescriptor(o, key)
		},

		getPrototypeOf(){
			return model.prototype
		}
	})
}

function controlMutation(model, def, path, o, key, applyMutation){
	const newPath = (path ? path + '.' + key : key),
	      isPrivate = model.conventionForPrivate(key),
	      isConstant = model.conventionForConstant(key),
	      isOwnProperty = o.hasOwnProperty(key),
	      initialPropDescriptor = isOwnProperty && Object.getOwnPropertyDescriptor(o, key);

	if(key in def && (isPrivate || (isConstant && o[key] !== undefined))){
		model.errorStack.push({
			message: `cannot modify ${isPrivate ? "private" : "constant"} ${key}`
		});
	}

	if(def.hasOwnProperty(key)){
		applyMutation(newPath);
		checkDefinition(o[key], def[key], newPath, model.errorStack, []);
		checkAssertions(o, model, newPath);
	} else {
		model.errorStack.push({
			message: `cannot find property ${newPath} in the model definition`
		});
	}

	if(model.errorStack.length){
		if(isOwnProperty) Object.defineProperty(o, key, initialPropDescriptor);
		else delete o[key]; // back to the initial property defined in prototype chain

		model.unstackErrors();
		return false
	}

	return true
}

const MUTATOR_METHODS = ["pop", "push", "reverse", "shift", "sort", "splice", "unshift"];

function ArrayModel(def){

	const model = function(array = model.default) {
		if(!is(model, this)) return new model(array)
		model.validate(array);
		return new Proxy(array, {
			get(arr, key) {
				if (MUTATOR_METHODS.includes(key)) return proxifyMethod(arr, key, model)
				return arr[key]
			},
			set(arr, key, val) {
				setArrayKey(arr, key, val, model);
				return true
			},
			getPrototypeOf(){
				return model.prototype
			}
		})
	};

	setConstructorProto(model, Array.prototype);
	initModel(model, arguments, ArrayModel);
	return model
}

setConstructorProto(ArrayModel, BasicModel.prototype);
Object.assign(ArrayModel.prototype, {

	toString(stack){
		return 'Array of ' + toString(this.definition, stack)
	},

	_validate(arr, path, errorStack, callStack){
		if(is(Array, arr))
			arr.forEach((a,i) => {
				arr[i] = checkDefinition(a, this.definition, `${path || "Array"}[${i}]`, errorStack, callStack, true);
			});
		else errorStack.push({
			expected: this,
			received: arr,
			path
		});

		checkAssertions(arr, this, path, errorStack);
	}
});

function proxifyMethod(array, method, model){
	return function() {
		const testArray = array.slice();
		Array.prototype[method].apply(testArray, arguments);
		model.validate(testArray);
		const returnValue = Array.prototype[method].apply(array, arguments);
		array.forEach((a,i)=> array[i] = cast(a, model.definition));
		return returnValue
	}
}

function setArrayKey(array, key, value, model){
	let path = `Array[${key}]`;
	if(parseInt(key) === +key && key >= 0)
		value = checkDefinition(value, model.definition, path, model.errorStack, [], true);

	const testArray = array.slice();
	testArray[key] = value;
	checkAssertions(testArray, model, path);
	model.unstackErrors();
	array[key] = value;
}

function FunctionModel(){

	const model = function(fn = model.default) {
		return new Proxy(fn, {
			getPrototypeOf: () => model.prototype,
			apply (fn, ctx, args) {
				const def = model.definition;
				args = Object.assign([], def.defaults, args);

				def.arguments.forEach((argDef, i) => {
					args[i] = checkDefinition(args[i], argDef, `arguments[${i}]`, model.errorStack, [], true);
				});

				checkAssertions(args, model, "arguments");

				let result;
				if(!model.errorStack.length){
					result = Reflect.apply(fn, ctx, args);
					if ("return" in def)
						result = checkDefinition(result, def.return, "return value", model.errorStack, [], true);
				}
				model.unstackErrors();
				return result
			}
		});
	};

	setConstructorProto(model, Function.prototype);

	const def = { arguments: [...arguments] };
	initModel(model, [ def ], FunctionModel);

	return model
}

setConstructorProto(FunctionModel, BasicModel.prototype);

Object.assign(FunctionModel.prototype, {

	toString(stack){
		let out = 'Function(' + this.definition.arguments.map(argDef => toString(argDef, stack)).join(",") +')';
		if("return" in this.definition) {
			out += " => " + toString(this.definition.return);
		}
		return out
	},

	return(def){
		this.definition.return = def;
		return this
	},

	defaults(){
		this.definition.defaults = [...arguments];
		return this
	},

	_validate(f, path, errorStack){
		if (!isFunction(f)) {
			errorStack.push({
				expected: "Function",
				received: f,
				path
			});
		}
	}
});

FunctionModel.prototype.assert(function(args){
	if (args.length > this.definition.arguments.length) return args
	return true
}, function(args){
	return `expecting ${this.definition.arguments.length} arguments for ${toString(this)}, got ${args.length}`
});

const MAP_MUTATOR_METHODS = ["set", "delete", "clear"];

function MapModel(def){

	const model = function(iterable) {
		const map = new Map(iterable);
		model.validate(map);

		for(let method of MAP_MUTATOR_METHODS){
			map[method] = function() {
				const testMap = new Map(map);
				Map.prototype[method].apply(testMap, arguments);
				model.validate(testMap);
				return Map.prototype[method].apply(map, arguments)
			};
		}

		setConstructor(map, model);
		return map
	};

	setConstructorProto(model, Map.prototype);
	initModel(model, arguments, MapModel);
	return model
}

setConstructorProto(MapModel, BasicModel.prototype);
Object.assign(MapModel.prototype, {

	toString(stack){
		return "Map of " + toString(this.definition, stack)
	},

	_validate(map, path, errorStack, callStack){
		if(map instanceof Map){
			for(let [key,val] of map){
				checkDefinition(val, this.definition, `${path || "Map"}[${key}]`, errorStack, callStack);
			}
		} else {
			errorStack.push({
				expected: this,
				received: map,
				path
			});
		}
		checkAssertions(map, this, errorStack);
	}
});

const SET_MUTATOR_METHODS = ["add", "delete", "clear"];

function SetModel(def){

	const model = function(iterable) {
		const _set = new Set(iterable);
		model.validate(_set);

		for(let method of SET_MUTATOR_METHODS){
			_set[method] = function() {
				const testSet = new Set(_set);
				Set.prototype[method].apply(testSet, arguments);
				model.validate(testSet);
				return Set.prototype[method].apply(_set, arguments)
			};
		}

		setConstructor(_set, model);
		return _set
	};

	setConstructorProto(model, Set.prototype);
	initModel(model, arguments, SetModel);
	return model
}

setConstructorProto(SetModel, BasicModel.prototype);
Object.assign(SetModel.prototype, {

	toString(stack){
		return "Set of " + toString(this.definition, stack)
	},

	_validate(_set, path, errorStack, callStack){
		if(_set instanceof Set){
			for(let item of _set.values()){
				checkDefinition(item, this.definition, (path || "Set"), errorStack, callStack);
			}
		} else {
			errorStack.push({
				expected: this,
				received: _set,
				path
			});
		}
		checkAssertions(_set, this, errorStack);
	}
});

exports.BasicModel = BasicModel;
exports.ObjectModel = ObjectModel;
exports.ArrayModel = ArrayModel;
exports.FunctionModel = FunctionModel;
exports.MapModel = MapModel;
exports.SetModel = SetModel;

}((this.ObjectModelBundle = this.ObjectModelBundle || {})));
