import dotenv from 'dotenv'
dotenv.config()
import moment from 'moment-timezone'
import TelegramBot from 'node-telegram-bot-api'
import fs from 'fs'
import puppeteer from 'puppeteer'

const delay = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const takeAttendance = async (classInfo) => {
  // Launch puppeteer
  console.log('Launching Puppeteer browser instance...')
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: false,
    // Sometimes not work, then set a slowMo
    // slowMo: 100,
  })
  // Grant permissions for the page to read its geolocation.
  const context = browser.defaultBrowserContext()
  await context.overridePermissions(process.env.OLE_BASE_URL, ['geolocation'])

  const page = await browser.newPage()
  // Sets the page's geolocation
  await page.setGeolocation({
    latitude: parseFloat(process.env.HKMU_LATITUDE),
    longitude: parseFloat(process.env.HKMU_LONGITUDE),
  })
  // await page.goto(process.env.OLE_LOGIN_URL)
  await page.goto(
    `${process.env.OLE_ATTENDANCE_URL}/${classInfo.courseCode}.nsf//class_activities_student?readform&`
  )
  console.log('Start login to the OLE...')
  // url will change auto like: 'https://ole.hkmu.edu.hk/names.nsf?Login&RedirectTo=https://ole.hkmu.edu.hk/course2300/comps351f.nsf//class_activities_student?readform&'
  // will change to 'https://ole.hkmu.edu.hk/names.nsf?Login&RedirectTo=https://ole.hkmu.edu.hk/course2300/comps351f.nsf//class_activities_student?readform&26'
  await page.waitForNavigation()

  // Input username and password
  const input_username = await page.$x(
    '/html/body/form/div[1]/table/tbody/tr[2]/td[2]/input[1]'
  )
  await input_username[0].type(process.env.HKMU_USERNAME)
  const input_password = await page.$x(
    '/html/body/form/div[1]/table/tbody/tr[2]/td[2]/input[2]'
  )
  await input_password[0].type(process.env.HKMU_PASSWORD)

  const button_enter = await page.$x(
    '/html/body/form/div[1]/table/tbody/tr[2]/td[2]/a'
  )
  await button_enter[0].click()
  await page.waitForNavigation()
  console.log('Logged into the platform!')

  // Old Method: Go to specific course page and take attendance
  // await page.goto(
  //   `${process.env.OLE_COURSE_URL}/${classInfo.courseCode}.nsf//class_activities_student?readform&`
  // )

  // Get current time
  const date = moment().tz('Asia/Hong_Kong')
  const formattedDate = date.format('YYYY-MM-DD-HH-mm-ss')

  // Check if attendance success
  await page.waitForSelector('#submitted_msg', { timeout: 3000 })
  const isSubmitted = await page.$('#submitted_msg')

  // Take screenshot
  console.log('Taking screenshot...')
  await delay(3000)
  const screenshot = await page.screenshot()
  const filename = `${classInfo.courseCode}-${formattedDate}`

  console.log('Closing Puppeteer browser instance...')
  await browser.close()

  console.log('Reporting Attendance...')
  await reportAttendance(isSubmitted, screenshot, filename, date, classInfo)
}

const reportAttendance = async (
  isSubmitted,
  screenshot,
  filename,
  date,
  classInfo
) => {
  // Send message with Telegram Bot
  const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN)
  const dateOfClass = date.format('YYYY/MM/DD') + ' ' + classInfo.time

  console.log('Sending attendance message to Telegram...')
  if (isSubmitted) {
    bot.sendDocument(
      process.env.TELEGRAM_CHAT_ID,
      screenshot,
      {
        caption: `Take Attendance Successfully !!!\nCourse Code: ${classInfo.courseCode.toUpperCase()}\nDate of Class: ${dateOfClass} 14:00\nSubmission Time: ${date}`,
      },
      { filename: filename }
    )
  } else {
    bot.sendDocument(
      process.env.TELEGRAM_CHAT_ID,
      screenshot,
      {
        caption: `Fail to Take Attendance !!!\nCourse Code: ${classInfo.courseCode.toUpperCase()}\nDate of Class: ${dateOfClass}\nSubmission Time: ${date}`,
      },
      { filename: filename }
    )
  }
  console.log('Attendance message sent successfully to Telegram!')
}

const checkAttendance = async () => {
  console.log('Checking for attendance data in schedule file...')
  const classes = JSON.parse(fs.readFileSync('./schedule.json', 'utf-8'))
  const currentTime = moment().tz('Asia/Hong_Kong')

  for (const classInfo of classes) {
    // Read time from class info
    const classTime = moment.tz(
      `${classInfo.weekday} ${classInfo.time}`,
      'dddd hh:mm A',
      'Asia/Hong_Kong'
    )

    // example: read 02:00 PM
    // If now is 02:00 pm, run script. If now is 03:00 pm, run script
    if (currentTime.isBetween(classTime, moment(classTime).add(1, 'hour'))) {
      // Additional check if it is already attended from attended.json. If no, then attend class
      console.log(
        'Found a class that needs to have attendance taken now: ',
        classInfo.courseCode
      )
      await takeAttendance(classInfo)
    }
  }
  console.log('All attendance processes completed successfully.')
}

checkAttendance()
