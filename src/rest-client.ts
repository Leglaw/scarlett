import { IRestOptions, IResponse, IRequest, HttpMethod, HTTPStatusCode, IRestOptionsGlobals } from './interfaces';
import RestError from "./rest-error";
import { getRequestUrl, setUrlParameters, resolveAny, transformResponseBody, transformRequestBody, mergeObject, cloneObject } from './utilities';
import RestOptions from "./rest-options";

export default class RestClient {
	private _cache = new Map<string, IResponse<any>>();
	public options: RestOptions;
	constructor(options?: Partial<IRestOptionsGlobals>) {
		this.options = new RestOptions(options ?? {});
	}
	//#region cache
	protected cacheKey(url: URL, method: HttpMethod | "*" = "*", customKey?: string) {
		const cacheKey = customKey?.trim() ? customKey : (this.options.get("cacheKey") ?? '');
		function formDataToObj(formData: FormData) {
			let o: any = {};
			formData.forEach((value, key) => (o[key] = value));
			return o;
		}
		const body = this.options.get("body");
		const responseType = this.options.get("responseType");
		const inputs = body ? (
			responseType === "json" ? JSON.stringify(body)
			: responseType === "text" ? body
			: responseType === "formData" ? JSON.stringify(formDataToObj(body as FormData))
			: ""
		) : "";
		return `${cacheKey}|${url.href}|${method}|${inputs}`;
	}
	protected cacheClear() {
		this._cache.clear();
	}
	protected cacheClearByKey(cacheKey?: string | null) {
		if (!cacheKey) return;
		for (let key of this._cache.keys())
			if (key.startsWith(`${cacheKey}|`))
				this._cache.delete(key);
	}
	protected cacheSet(response: IResponse<any>, customKey?: string) {
		const key = this.cacheKey(response.request.url, response.request.method, customKey);
		this._cache.set(key, response);
	}
	protected cacheGet<TResponse>(url: URL, method: HttpMethod | "*" = "*", customKey?: string) {
		const key = this.cacheKey(url, method, customKey);
		return this._cache.get(key) as IResponse<TResponse> | undefined | null;
	}
	//#endregion
	//#region request shortcut
	public get<TResponse, TError = any>(path: string, overrides?: Partial<IRestOptions>) {
		return this.request<TResponse, TError>("GET", path, overrides);
	}
	public delete<TResponse, TError = any>(path: string, overrides?: Partial<IRestOptions>) {
		return this.request<TResponse, TError>("DELETE", path, overrides);
	}
	public post<TResponse, TError = any>(path: string, overrides?: Partial<IRestOptions>) {
		return this.request<TResponse, TError>("POST", path, overrides);
	}
	public put<TResponse, TError = any>(path: string, overrides?: Partial<IRestOptions>) {
		return this.request<TResponse, TError>("PUT", path, overrides);
	}
	public patch<TResponse, TError = any>(path: string, overrides?: Partial<IRestOptions>) {
		return this.request<TResponse, TError>("PATCH", path, overrides);
	}
	//#endregion

	protected optionsOverride(overrides?: Partial<IRestOptions>, base?: Partial<IRestOptions>) {
		const target = base ?? this.options.current();
		if (this.options.get("overrideStrategy") === "merge") {
			let o = cloneObject(target);
			return mergeObject(o, overrides ?? {}, ["body"]);
		}
		else return Object.assign({}, target, overrides ?? {});
	}
	public async request<TResponse, TError = any>(method: HttpMethod, path: string, requestOptions?: Partial<IRestOptions>) : Promise<IResponse<TResponse, TError>> {
		const that = this;
		const localOptions: Partial<IRestOptions> = requestOptions
			? this.optionsOverride(requestOptions)
			: this.options.current()
		const url = getRequestUrl(localOptions.host, localOptions.basePath, path);

		if (localOptions.query && Object.keys(localOptions.query).length)
			setUrlParameters(url, localOptions);

		localOptions.cacheKey = localOptions.cacheKey?.trim();
		if (localOptions.internalCache) {
			const cachedResponse = this.cacheGet<TResponse>(url, method);
			if (cachedResponse) return cachedResponse;
		}
		if (!localOptions.abortController)
			localOptions.abortController = new AbortController();

		const request: IRequest = {
			method, options: localOptions, url,
			body: localOptions.body
		};

		const onRequest = this.options.get("onRequest");
		if (typeof onRequest == "function") {
			const result = onRequest(request);
			if (result instanceof Promise)
				await result;
		}

		let timeoutTriggered = false;
		let fetchFullFilled = false;
		const [fetchResponse, fetchError] = await resolveAny<Response, Error>(new Promise((resolve, reject) => {
			const req: RequestInit = {
				method,
				body: method === "GET" ? undefined : transformRequestBody(localOptions.body),
				signal: localOptions.abortController?.signal,
				cache: localOptions.cache,
				headers: localOptions.headers,
				credentials: localOptions.credentials,
				keepalive: localOptions.keepalive,
				mode: localOptions.mode,
				redirect: localOptions.redirect,
				referrerPolicy: localOptions.referrerPolicy,
				referrer: localOptions.referrer
			};
			const timeoutId = localOptions.timeout
				? setTimeout(onRequestTimeout, localOptions.timeout)
				: null;
			function onRequestTimeout() {
				if (fetchFullFilled) return;
				timeoutTriggered = true;
				localOptions.abortController?.abort();
				reject(new Error("timeout"));
			}
			function stopTimeout() {
				if (timeoutId)
					clearTimeout(timeoutId);
				if (timeoutTriggered) return;
				timeoutTriggered = false;
			};
			fetch(url.href, req)
				.then((response) => {
					if (timeoutTriggered) return;
					stopTimeout();
					fetchFullFilled = true;
					resolve(response);
				})
				.catch(error => {
					if (timeoutTriggered) return;
					stopTimeout();
					reject(error);
				});
		}));

		const transformResult = await transformResponseBody(request, fetchResponse);
		localOptions.responseType = transformResult.resultType;
		const data = transformResult.result;
		const isBodyParseError = transformResult.success === false;
		const isTimeout = timeoutTriggered && !fetchFullFilled;
		const isAbort = fetchError?.name === 'AbortError' && !fetchFullFilled;
		const response: IResponse<TResponse, TError> = {
			fetchResponse,
			headers: fetchResponse?.headers,
			request, data,
			status: fetchResponse?.status as HTTPStatusCode,
			repeat(m?: HttpMethod | Partial<IRestOptions>, repeatOptions?: Partial<IRestOptions>) {
				if (arguments.length == 2) {
					m = (m ? m : method);
					repeatOptions = (repeatOptions ? repeatOptions : {});
				}
				else if (arguments.length == 1) {
					repeatOptions = (m ? m : {}) as IRestOptions;
					m = method;
				}
				else if (!arguments.length) {
					m = method;
					repeatOptions = {};
				}
				const newOpts = that.optionsOverride(repeatOptions, localOptions);
				return that.request<TResponse, TError>(m as HttpMethod, path, newOpts);
			}
		};

		if (isBodyParseError || isTimeout || isAbort) {
			const seconds = (localOptions.timeout!/1000).toFixed(2);
			const secondsIsOne = (localOptions.timeout!/1000).toFixed(1).replace(".0", "") == "1";
			const message = isTimeout ? `Request timed out after ${seconds} second${secondsIsOne ? "" : "s"}`
				: isBodyParseError ? `An error occurred while parsing the response body as ${localOptions.responseType}`
				: isAbort ? `Request aborted` : ""
			response.error = new RestError<TError>(message, undefined, isTimeout ? "Timeout" : "BodyParse");
		}
		else if (fetchError) {
			const err = new RestError<TError>(fetchError.message, response.status);
			err.stack = fetchError.stack;
			response.error = err;
		}
		else if (fetchResponse?.ok === false) {
			const err = new RestError<TError>(fetchResponse.statusText, fetchResponse.status);
			response.error = err;
		}

		let onErrorCalled = false;
		if (response.error && !isAbort) {
			response.error.data = data;
			response.error.request = request;
			response.error.fetchResponse = fetchResponse ?? undefined;
			response.data = null;
			const couldThrow = Boolean(localOptions.throw || localOptions.throwExcluding?.length);
			if (couldThrow) {
				const throwFilterFound = await response.error.findMatch(localOptions.throwExcluding ?? []);
				if (throwFilterFound)
					response.throwFilter = throwFilterFound;
				else {
					const onError = this.options.get("onError");
					if (typeof onError == "function") {
						onErrorCalled = true;
						onError(response.error, response);
					}
					else throw response.error;
				}
			}
		}
		if (localOptions.internalCache)
			this.cacheSet(response);

		if (!onErrorCalled) {
			const onReponse = this.options.get("onResponse");
			if (typeof onReponse == "function")
				onReponse(response);
		}

		return response;
	}
}