import { Model } from "./model"
import {checkDefinition, checkAssertions, extendDefinition} from "./definition"
import { extend, isFunction, setConstructor, toString } from "./helpers"


function FunctionModel() {

	const model = function(fn = model.default) {
		return new Proxy(fn, {
			getPrototypeOf: () => model.prototype,

			apply (fn, ctx, args) {
				const def = model.definition

				def.arguments.forEach((argDef, i) => {
					args[i] = checkDefinition(args[i], argDef, `arguments[${i}]`, model.errors, [], true)
				})

				checkAssertions(args, model, "arguments")

				let result
				if(!model.errors.length){
					result = Reflect.apply(fn, ctx, args)
					if ("return" in def)
						result = checkDefinition(result, def.return, "return value", model.errors, [], true)
				}
				model.unstackErrors()
				return result
			}
		});
	}

	extend(model, Function)
	setConstructor(model, FunctionModel)
	model._init([ { arguments: [...arguments] } ])

	return model
}

extend(FunctionModel, Model, {
	toString(stack){
		let out = 'Function(' + this.definition.arguments.map(argDef => toString(argDef, stack)).join(",") +')'
		if("return" in this.definition) {
			out += " => " + toString(this.definition.return)
		}
		return out
	},

	return(def){
		this.definition.return = def
		return this
	},

	extend(newArgs, newReturns) {
		return Model.prototype.extend.call(this, {
			key: extendDefinition(this.definition.arguments, newArgs),
			value: extendDefinition(this.definition.return, newReturns)
		})
	},

	_validate(f, path, errors){
		if (!isFunction(f)) {
			errors.push({
				expected: "Function",
				received: f,
				path
			})
		}
	}
})

FunctionModel.prototype.assert(function(args){
	if (args.length > this.definition.arguments.length) return args
	return true
}, function(args){
	return `expecting ${this.definition.arguments.length} arguments for ${toString(this)}, got ${args.length}`
})

export default FunctionModel