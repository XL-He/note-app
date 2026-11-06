package com.sticky.notes;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * 前台守护服务：让应用进程保持存活。
 *
 * 为什么要它：用户从最近任务里「划掉」应用时，绝大多数 ROM 会把它置为
 * force-stopped 状态。处于该状态的应用，系统不会向其投递任何广播——
 * 而 LocalNotifications 的提醒正是靠 AlarmManager 触发广播来响铃的。
 * 结果就是：划掉后提醒静默，重新打开应用才补响。
 *
 * 进程持有前台服务时不是 stopped 状态：划掉任务卡只移除任务栈，
 * 进程继续存在，闹钟照常触发。这是所有闹钟/时钟类应用的标准做法。
 *
 * 常驻通知用独立的低优先级渠道（无声、不弹横幅）。
 */
public class KeepAliveService extends Service {
    private static final String CHANNEL_ID = "keepalive";
    private static final int NOTIF_ID = 42;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForegroundWithNotification();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "后台守护", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("保持进程存活，让提醒闹钟能准点触发");
                ch.setSound(null, null);
                ch.enableVibration(false);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void startForegroundWithNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(this, CHANNEL_ID);
        } else {
            b = new Notification.Builder(this);
        }
        b.setSmallIcon(R.drawable.ic_stat_icon)
                .setContentTitle("便签")
                .setContentText("提醒守护中 · 点击打开")
                .setContentIntent(pi)
                .setOngoing(true);

        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 34) {
            // Android 14+ 必须声明前台服务类型，specialUse 配合 manifest 的 property
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 被系统回收后尽量重建
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
