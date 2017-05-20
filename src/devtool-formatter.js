import ObjectModel from "./object-model"
import BasicModel from "./basic-model"
import {is, isFunction, isPlainObject} from "./helpers"

const styles = {
	list: `list-style-type: none; padding: 0; margin: 0;`,
	listItem: `padding: 0 0 0 1em;`,
	model: `color: #43a047; font-style: italic`,
	function: `color: #4271ae`,
	string: `color: #C41A16`,
	number: `color: #1C00CF`,
	boolean: `color: #AA0D91`,
	property: `color: #881391`,
	private: `color: #B871BD`,
	null: `color: #808080`
};

function getModel(instance){
	if(instance === undefined || instance === null)
		return null;

	const proto = Object.getPrototypeOf(instance);
	if(!proto || !proto.constructor || !is(BasicModel, proto.constructor))
		return null;

	return proto.constructor
}

function format(x, config){
	if(x === null || x === undefined)
		return ["span", { style: styles.null }, String(x)];

	if(typeof x === "boolean")
		return ["span", { style: styles.boolean }, x];

	if(typeof x === "number")
		return ["span", { style: styles.number }, x];

	if(typeof x === "string")
		return ["span", { style: styles.string }, `"${x}"`];

	if(is(Array, x)){
		let def = [];
		if(x.length === 1) x.push(undefined, null);
		for(let i=0; i < x.length; i++){
			def.push(format(x[i]) )
			if(i < x.length - 1) def.push(' or ')
		}
		return ["span", {}, ...def]
	}

	if(isPlainObject(x))
		return formatObject(x, getModel(x), config)

	if(isFunction(x) && !is(BasicModel, x))
		return ["span", { style: styles.function }, x.name || x.toString()];

	return x ? ['object', { object: x, config }] : null
}

function formatObject(o, model, config){
	return [
		'ol', { style: styles.list },
		'{',
		...Object.keys(o).map(prop => {
			let isPrivate = model && model.conventionForPrivate(prop);
			return ['li', { style: styles.listItem },
				['span', { style: isPrivate ? styles.private : styles.property }, prop], ': ',
				format(o[prop], config)
			]
		}),
		'}'
	];
}

function formatHeader(x, config){
	if(is(BasicModel, x))
		return ["span", { style: styles.model }, x.name];

	if(config.fromModel || isPlainObject(x) || Array.isArray(x))
		return format(x)

	return null;
}

const ModelFormatter = {
	header: function(x, config={}) {
		if (config.fromModel || is(BasicModel, x))
			return formatHeader(x, config);

		return null;
	},
	hasBody: function(x) {
		return is(BasicModel, x)
	},
	body: function(x) {
		return format(x.definition, { fromModel: true })
	}
}

const ModelInstanceFormatter = {
	header: function(x, config={}) {
		if(config.fromInstance && isPlainObject(x)){
			return formatHeader(x, config)
		}

		const model = getModel(x);
		if(is(BasicModel, model)){
			return ["span", { style: styles.model }, x.constructor.name];
		}

		return null;
	},
	hasBody: function(x) {
		return x && is(ObjectModel, getModel(x))
	},
	body: function(x) {
		return formatObject(x, getModel(x), { fromInstance: true })
	}
}

if (typeof window !== "undefined") {
	window.devtoolsFormatters = (window.devtoolsFormatters || [])
		.concat(ModelFormatter, ModelInstanceFormatter);
}