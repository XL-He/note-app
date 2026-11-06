package com.sticky.notes;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自定义的 WebDAV 代理插件必须在 super.onCreate 之前注册，
        // 那时 Capacitor 的桥还没初始化完成。
        registerPlugin(DavPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
