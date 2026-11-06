package com.sticky.notes;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Iterator;

import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * WebDAV 请求代理。
 *
 * 为什么需要自己写：Capacitor 自带的 CapacitorHttp 对 HTTP 方法做了白名单，
 * 只接受 OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/PATCH，
 * 而 WebDAV 需要 MKCOL 和 PROPFIND，会被直接拒绝
 * （报 "Expected one of [...] but was MKCOL"）。
 *
 * 这里直接用 OkHttp 发请求，OkHttp 允许任意方法名，同时支持二进制请求体，
 * 顺带把 CORS 问题也绕开了（原生网络层不经过浏览器的同源策略）。
 */
@CapacitorPlugin(name = "DavClient")
public class DavPlugin extends Plugin {

    private OkHttpClient client;

    private OkHttpClient client() {
        if (client == null) {
            client = new OkHttpClient.Builder()
                    .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(90, java.util.concurrent.TimeUnit.SECONDS)
                    .writeTimeout(90, java.util.concurrent.TimeUnit.SECONDS)
                    .followRedirects(true)
                    .build();
        }
        return client;
    }

    @PluginMethod
    public void request(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("缺少 url");
            return;
        }
        final String method = call.getString("method", "GET");
        final String bodyBase64 = call.getString("bodyBase64");
        final String contentType = call.getString("contentType", "application/octet-stream");
        final JSObject headersObj = call.getObject("headers");

        // 网络请求不能占主线程，否则大文件上传会卡住界面
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Request.Builder builder = new Request.Builder().url(url);

                    if (headersObj != null) {
                        Iterator<String> it = headersObj.keys();
                        while (it.hasNext()) {
                            String name = it.next();
                            String value = headersObj.getString(name);
                            if (name != null && value != null) {
                                builder.addHeader(name, value);
                            }
                        }
                    }

                    RequestBody body = null;
                    if (bodyBase64 != null) {
                        byte[] bytes = Base64.decode(bodyBase64, Base64.NO_WRAP);
                        body = RequestBody.create(bytes, MediaType.parse(contentType));
                    }

                    // OkHttp 允许任意 HTTP 方法名；只有 GET/HEAD 必须不带 body
                    builder.method(method, body);

                    Response response = client().newCall(builder.build()).execute();
                    try {
                        ResponseBody rb = response.body();
                        byte[] bytes = rb != null ? rb.bytes() : new byte[0];

                        final JSObject out = new JSObject();
                        out.put("status", response.code());
                        out.put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));

                        JSObject outHeaders = new JSObject();
                        Headers hs = response.headers();
                        for (String name : hs.names()) {
                            outHeaders.put(name.toLowerCase(), hs.get(name));
                        }
                        out.put("headers", outHeaders);

                        resolveOnUi(call, out);
                    } finally {
                        response.close();
                    }
                } catch (final Exception e) {
                    final String msg = e.getMessage() != null ? e.getMessage() : e.toString();
                    if (getActivity() != null) {
                        getActivity().runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                call.reject(msg);
                            }
                        });
                    }
                }
            }
        }).start();
    }

    private void resolveOnUi(final PluginCall call, final JSObject out) {
        if (getActivity() == null) {
            call.resolve(out);
            return;
        }
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                call.resolve(out);
            }
        });
    }
}
