import { IRestOptions, IRestOptionsGlobals } from './interfaces';
import RestClient from '.';
import { cloneObject, mergeObject, cloneValue } from './utilities';

export default class RestOptions {
	private _options: Partial<IRestOptionsGlobals>;
	private _restFactory: typeof RestClient;
	constructor(options?: Partial<IRestOptionsGlobals>, factoryClass?: typeof RestClient) {
		this._options = options ?? {};

		this._restFactory = factoryClass ?? RestClient;
		this.checkAndRestoreDefaults();
	}
	private checkAndRestoreDefaults() {
		if (!this._options.overrideStrategy) this._options.overrideStrategy = "merge";
		if (!this._options.abortController) this._options.abortController = new AbortController();
		if (!this._options.credentials) this._options.credentials = "same-origin";
		if (!this._options.mode) this._options.mode = "same-origin";
		if (!this._options.cache) this._options.cache = "default";
		if (!this._options.redirect) this._options.redirect = "follow";
		if (typeof this._options.referrer == "undefined") this._options.referrer = "";
		if (!this._options.referrerPolicy) this._options.referrerPolicy = "no-referrer-when-downgrade";
		if (typeof this._options.timeout === "undefined") this._options.timeout = 30000;
		if (typeof this._options.throw === "undefined" && this._options.throwExcluding && this._options.throwExcluding.length)
			this._options.throw = true;
	}
	public current() {
		return cloneObject(this._options);
	}
	public setFactory(factoryClass: typeof RestClient) {
		this._restFactory = factoryClass;
		return this;
	}
	public createRestClient<T extends RestClient>() {
		const options = this.clone()._options;
		return new this._restFactory(options) as T;
	}
	public get<K extends keyof IRestOptionsGlobals>(key: K) {
		return cloneValue(this._options, key) as IRestOptionsGlobals[K];
	}
	public set<K extends keyof IRestOptionsGlobals>(key: K, val: IRestOptionsGlobals[K]) {
		this._options[key] = val;
		return this;
	}
	public unset<K extends keyof IRestOptions>(key: K) {
		delete this._options[key];
		this.checkAndRestoreDefaults();
		return this;
	}
	public clone() {
		const cloned = cloneObject(this._options);
		return new RestOptions(cloned);
	}
	public merge(obj?: Partial<IRestOptions>) {
		mergeObject(this._options, obj ?? {});
		return this;
	}
	public assign(obj?: Partial<IRestOptions>) {
		Object.assign(this._options, obj ?? {});
		return this;
	}
}