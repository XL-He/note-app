package com.sticky.notes;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自定义的 WebDAV 代理插件必须在 super.onCreate 之前注册，
        // 那时 Capacitor 的桥还没初始化完成。
        registerPlugin(DavPlugin.class);
        super.onCreate(savedInstanceState);

        // 启动前台守护服务：应用在前台时才允许启动前台服务，onCreate 正好满足。
        // 进程因此不会进入 force-stopped 状态，
        // 用户划掉任务卡后提醒闹钟依然能触发（否则广播会被系统拦截，提醒静默）。
        Intent svc = new Intent(this, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(svc);
        } else {
            startService(svc);
        }
    }
}
